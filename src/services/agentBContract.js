export const AGENT_B_OUTPUT_COLUMNS = Object.freeze([
  'duration',
  'stage',
  'notes',
  'speech',
  'analysisBoard',
  'solutionBoard',
  'actionSpec',
])

export const AGENT_B_STAGES = Object.freeze(['题目', '分析', '解答', '答语', '总结'])

const ANALYSIS_PLACEHOLDERS = new Set([
  '',
  '保持当前画面，不新增标注',
  '不书写',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateAgentBRowsContract(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'Agent B 必须返回至少一行七列表数据' }
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!isRecord(row)) return { ok: false, error: `第 ${index + 1} 行必须是对象` }

    const missing = AGENT_B_OUTPUT_COLUMNS.filter((field) => !Object.hasOwn(row, field))
    if (missing.length) {
      return { ok: false, error: `第 ${index + 1} 行缺少字段：${missing.join('、')}` }
    }
    if (row.duration !== '待程序预估') {
      return { ok: false, error: `第 ${index + 1} 行 duration 必须写“待程序预估”` }
    }
    if (!AGENT_B_STAGES.includes(row.stage)) {
      return { ok: false, error: `第 ${index + 1} 行 stage 不在固定枚举中` }
    }
    for (const field of ['notes', 'speech', 'analysisBoard', 'solutionBoard']) {
      if (typeof row[field] !== 'string' || !row[field].trim()) {
        return { ok: false, error: `第 ${index + 1} 行 ${field} 不能为空` }
      }
    }
    if (!Array.isArray(row.actionSpec) && typeof row.actionSpec !== 'string') {
      return { ok: false, error: `第 ${index + 1} 行 actionSpec 必须是数组` }
    }
  }

  const firstAnalysisIndex = rows.findIndex((row) => (
    row.stage === '分析' && !ANALYSIS_PLACEHOLDERS.has(row.analysisBoard.trim())
  ))
  if (firstAnalysisIndex < 0) {
    return { ok: false, error: '七列表缺少有效分析步骤；分析区必须是教学主板书' }
  }

  const firstSolutionIndex = rows.findIndex((row) => row.solutionBoard.trim() !== '不书写')
  if (firstSolutionIndex >= 0 && firstSolutionIndex < firstAnalysisIndex) {
    return { ok: false, error: '解题区算式出现在分析依据之前' }
  }

  return { ok: true, value: rows }
}
