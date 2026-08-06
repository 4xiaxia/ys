/* @qh-core LANE=B-V2 POINT=CONTRACT_VALIDATE stage enum + first-row read-question gate */
export const AGENT_B_V2_COLUMNS = Object.freeze([
  'duration',
  'stage',
  'notes',
  'speech',
  'board',
  'actionSpec',
])

export const AGENT_B_V2_STAGES = Object.freeze(['题目', '分析', '解答', '答语', '总结'])
const GEOMETRY_DRAWING_TOOLS = new Set([
  'draw',           // 意图描述工具（首选，Agent C 负责执行）
  'rough-line',
  'rough-arrow',
  'rough-rect',
  'rough-ellipse',
  'rough-polygon',
])

const EMPTY_BOARD_TEXTS = new Set([
  '',
  '保持分析区当前画面，不新增板书',  // 旧版读题行占位，向后兼容清理
  '不书写',                          // 旧版解题区无内容占位，向后兼容清理
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(text) {
  const source = String(text || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || source
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export function normalizeAgentBV2BoardCells(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    board: typeof row?.board === 'string' && EMPTY_BOARD_TEXTS.has(row.board.trim())
      ? ''
      : row?.board,
    // 模型偶尔漏写 actionSpec，自动补空数组而不是卡死整表
    actionSpec: Array.isArray(row?.actionSpec) ? row.actionSpec : [],
  }))
}

export function validateAgentBV2Rows(rows, options = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'Agent B 必须返回至少一行七列表数据' }
  }

  // 先归一化：补全 actionSpec 默认值、清理旧占位文本；后续全用 normalizedRows 做校验
  const normalizedRows = normalizeAgentBV2BoardCells(rows)

  if (normalizedRows[0]?.stage !== '题目') {
    return { ok: false, error: '七列表第一行必须是读题环节，stage 必须写”题目”' }
  }
  if (typeof normalizedRows[0]?.board !== 'string' || normalizedRows[0].board.trim() !== '') {
    return { ok: false, error: '读题行不得提前写板书，board 应留空字符串' }
  }
  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index]
    if (!isRecord(row)) return { ok: false, error: `第 ${index + 1} 行必须是对象` }

    const keys = Object.keys(row)
    const missing = AGENT_B_V2_COLUMNS.filter((field) => !Object.hasOwn(row, field))
    const extra = keys.filter((field) => !AGENT_B_V2_COLUMNS.includes(field))
    if (missing.length) return { ok: false, error: `第 ${index + 1} 行缺少字段：${missing.join('、')}` }
    if (extra.length) return { ok: false, error: `第 ${index + 1} 行包含未定义字段：${extra.join('、')}` }
    if (row.duration !== '待程序预估') {
      return { ok: false, error: `第 ${index + 1} 行 duration 必须写”待程序预估”` }
    }
    if (!AGENT_B_V2_STAGES.includes(row.stage)) {
      return { ok: false, error: `第 ${index + 1} 行 stage 不在固定枚举中` }
    }
    for (const field of ['notes', 'speech']) {
      if (typeof row[field] !== 'string' || !row[field].trim()) {
        return { ok: false, error: `第 ${index + 1} 行 ${field} 不能为空` }
      }
    }
    if (typeof row.board !== 'string') {
      return { ok: false, error: `第 ${index + 1} 行 board 必须是字符串` }
    }
    if (!Array.isArray(row.actionSpec)) {
      return { ok: false, error: `第 ${index + 1} 行 actionSpec 必须是数组` }
    }
  }

  // 所有题型：必须有分析行
  const hasAnalysis = normalizedRows.some((row) => row.stage === '分析')
  if (!hasAnalysis) {
    return { ok: false, error: '七列表缺少分析环节（stage=分析）：分析区是教学核心，不可跳过' }
  }

  if (options.problemType === 'geometry') {
    const hasAnalysisDrawing = normalizedRows.some((row) => (
      row.stage === '分析'
      && row.actionSpec.some((entry) => (
        entry?.action?.region === 'analysis'
        && GEOMETRY_DRAWING_TOOLS.has(entry.action.tool)
      ))
    ))
    if (!hasAnalysisDrawing) {
      return { ok: false, error: '几何题必须在分析区画图：至少一个分析行要使用已注册的 rough 绘图工具' }
    }
  }

  return { ok: true, value: normalizedRows }
}

export function parseAgentBV2Response(text) {
  const parsed = parseJsonObject(text)
  if (!isRecord(parsed)) return { ok: false, error: 'Agent B 返回内容不是 JSON 对象' }
  const topKeys = Object.keys(parsed)
  if (topKeys.length !== 1 || topKeys[0] !== 'rows') {
    return { ok: false, error: 'Agent B 顶层只能返回 {"rows":[...]}' }
  }
  return validateAgentBV2Rows(parsed.rows)
}
