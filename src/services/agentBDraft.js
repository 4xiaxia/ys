/* @qh-core LANE=OLD POINT=AGENT_B_CLIENT frozen dual-stage board-draft API
 * apiKey / endpoint / model 全部由前端用户在「Agent 配置」里填写，
 * 统一存于 userApiConfig（localStorage key: qinghuabu.userApiConfig.v1）。
 */
import { getAgentBoardToolCatalog } from '../board-tools/boardToolCatalog.js'
import { CANVAS_W, CANVAS_H } from '../utils/canvasCoords.js'
import { getAgentBoardTypographyPolicy } from '../board-tools/boardTypography.js'
import { applyEstimatedSpeechTimeline, getAgentBSpeechPolicy } from './speechTiming.js'
import { getAgentBBoardMathPolicy, validateAgentBBoardRows } from './boardMathPolicy.js'
import { resolveAgentBTeachingStrategy } from './agentBStrategies.js'
import { selectAgentBRelatedKnowledge } from './agentBKnowledge.js'
import { validateAgentBSolutionCheck } from './agentBDraftResult.js'
import { validateAgentBActionSpecs } from './agentBActionSpec.js'
import { AGENT_B_OUTPUT_COLUMNS, validateAgentBRowsContract } from './agentBContract.js'
import { getUserApiSnapshot } from '../lib/userApiConfig.js'

/**
 * Agent B · 板书参数书稿生成
 * 把自己带入：我必须同时看到「提示词要求」+「页面预览图」才能填 7 列表。
 * 草率配置 = 必然胡写坐标/混分析解题区。
 */

export const AGENT_B_STORAGE_KEY = 'qinghuabu.step2.agentBConfig'
const STEP1_AGENT_STORAGE_KEY = 'qinghuabu.step1.agentConfig'
export const AGENT_B_PROMPT_SCHEMA_VERSION = 'direct-seven-column-v2'
export const AGENT_B_CONNECTION_SCHEMA_VERSION = 'slots-v1'
export const AGENT_B_REQUEST_TIMEOUT_MS = 65000
export const AGENT_B_CONNECTION_SLOTS = Object.freeze(['primary', 'backup1', 'backup2'])
export const AGENT_B_STAGE = Object.freeze({
  SOLUTION_DRAFT: 'solution_draft',
  BOARD_SCRIPT: 'board_script',
})

const AGENT_B_COMMON_PROMPT = [
  '【不可覆盖的 Agent B 程序契约】',
  '1. 严格按 userPayload.taskStage 完成当前阶段；不得跨阶段提前产出。',
  '2. 只使用第1步用户已确认的真题、真画布和布局；禁止改写、移动或重新设计已确认题目。',
  '3. 没有数据就明确留空，禁止样例回填或隐性假设。',
  '4. 只返回一个 JSON 对象，不要 markdown，不要解释。',
].join('\n')

const AGENT_B_SOLUTION_PROMPT = [
  '【阶段A：B-A 解题草案】',
  '1. 当前只独立解题并核验答案、单位、步骤与不确定项。',
  '2. 不生成 rows、口播、坐标、板书动作或工具调用。',
  '3. 只返回 { "solutionCheck": { "answer":"最终答案", "steps":["可核验步骤"], "unitCheck":"单位检查或无单位", "verification":"验算说明", "uncertainItems":[] } }。',
].join('\n')

const AGENT_B_SCRIPT_PROMPT = [
  '【阶段B：B-B 直接生成七列表剧本】',
  '',
  '一、输入与产出边界',
  '1. 第1步题目、题型、布局和真画布预览已经由用户确认，是不可覆盖输入；不得反问、改题或输出待确认项。',
  '2. 在内部独立解题并核对答案、步骤、单位和验算，但最终只输出七列表 rows。',
  '3. 你只负责教学顺序、布局意图、口播和板书动作剧本；不负责实际写字或画图，不输出执行代码。',
  '',
  '二、教学定位',
  '4. 本产品是面向小学生的讲题答疑；重点是逐步分析和讲解，不是展示答案。',
  '5. analysisBoard 是主板书列，必须分步骤承载题型推理、知识点、图形、条件标注、数量关系、公式依据和必要的过程板书。',
  '6. 分析通常有多个步骤。每个关键推理先由 speech 讲清，并在 analysisBoard 出现对应板书，再在 solutionBoard 写对应的规范算式。',
  '7. userPayload.relatedKnowledge 来自关联知识表；用其中的考点、策略方法、讲解要点和易错点组织分析步骤，但不得机械照抄或引入本题无关知识。',
  '8. solutionBoard 只负责收束已经分析清楚的算式、结果和答语，不得取代分析过程。答案只能在推理完成后出现。',
  '9. 行数与讲解步骤按本题实际推理自行安排；分析可有很多步，复杂题按关键推理拆分，不机械填满模板。',
  '',
  '三、duration 与 speech',
  '10. duration 一律写"待程序预估"。程序按 speech 与每分钟170字生成连续预计时间，后续由真实 TTS 覆盖。',
  '11. speech 只写可直接发音的纯文本；不要输出"【点击生成语音】"，它是前端按钮。',
  '',
  '四、口播规则（面向 TTS）',
  '12. 分数口播写"分母分之分子"，数字用阿拉伯数字：5/8→8分之5；1 1/2→1又2分之1；口播禁止斜杠和 KaTeX。',
  '13. 小数口播逐位读：3.14→3点一四，0.05→0点零五；小数点后使用汉字数字。',
  '14. 未知数 x 在口播写"艾克斯"，乘号 x 在口播写"乘以"，+ 在口播写"加"；notes 必须注明板书 x 的语义。',
  '',
  '五、板书规则（KaTeX 与字体）',
  '15. 板书分数必须写 KaTeX 上下结构：5/8→\\frac{5}{8}；1 1/2→1\\frac{1}{2}；板书禁止斜杠和口播式分数。',
  '16. 中文标题、推理、答语、总结使用用户已选板书字体；不要用 KaTeX \\text 包住中文。',
  '',
  '六、actionSpec 动作稿规则',
  '17. actionSpec 只能使用 userPayload.availableBoardTools 中真实存在的工具 ID 和参数；禁止使用库原生但未开放的动作。',
  '18. RoughNotation 按区域+精确原文+出现次数定位，不使用坐标；多个目标必须拆成多个串行动作。',
  '19. 每个动作写明同一行 speech 中的触发语句；程序负责换算时间。缺少执行工具时写 CAPABILITY_GAP(能力ID):需要什么，禁止自造"普通板书"等工具。',
  '20. 所有板书动作全表串行、互斥；前一动作结束并预留 1000ms 抬笔间隔后，下一动作才能开始。',
  '',
  '七、输出契约',
  '21. 不得自行声称"全部检查通过"；只陈述实际满足的契约与仍存在的能力缺口。',
  '22. 只返回 { "rows": [...] }；不要返回 solutionCheck 或 uncertainItems。',
  '23. rows 每项固定包含 duration、stage、notes、speech、analysisBoard、solutionBoard、actionSpec；duration 写"待程序预估"。',
  '24. actionSpec 使用数组；每项是 {"cueText":"同一行口播中的触发原文","action":{注册工具动作}} 或 {"cueText":"触发原文","capabilityGap":{"id":"能力ID","need":"需要什么"}}。',
].join('\n')

export const AGENT_B_FOUNDATION_PROMPT = [
  AGENT_B_COMMON_PROMPT,
  AGENT_B_SOLUTION_PROMPT,
  AGENT_B_SCRIPT_PROMPT,
].join('\n\n')

export function getAgentBFoundationPrompt(taskStage) {
  if (taskStage === AGENT_B_STAGE.BOARD_SCRIPT) {
    return [AGENT_B_COMMON_PROMPT, AGENT_B_SCRIPT_PROMPT].join('\n\n')
  }
  return [AGENT_B_COMMON_PROMPT, AGENT_B_SOLUTION_PROMPT].join('\n\n')
}

export function validateAgentBConfirmedSolution(confirmedSolution, solutionConfirmed) {
  if (!solutionConfirmed) throw new Error('必须由用户预览确认解题草案后，才能生成剧本')
  const confirmedResult = validateAgentBSolutionCheck(confirmedSolution)
  if (!confirmedResult.ok) throw new Error(`缺少用户确认解法：${confirmedResult.error}`)
  if (confirmedResult.value.uncertainItems.length) throw new Error('解题草案仍有待确认项，不能生成剧本')
  return confirmedResult.value
}

export const AGENT_B_DEFAULTS = {
  promptSchemaVersion: AGENT_B_PROMPT_SCHEMA_VERSION,
  pageName: '第2步 · 板书参数书稿 Agent B',
  role: 'board_param_drafter',
  /** 必须多模态：要看真画布预览图 */
  capability: 'multimodal',
  connectionSchemaVersion: AGENT_B_CONNECTION_SCHEMA_VERSION,
  solutionAgentSlot: 'primary',
  // endpoint/model 默认空——由全局 userApiConfig 提供；
  // 若用户在 BoardParamDraft 里为本线单独填了 endpoint/model，则优先用本线的。
  solutionAgent: {
    endpoint: '',
    model: '',
    temperature: 0.1,
  },
  solutionAgentBackups: [
    { endpoint: '', model: '', temperature: 0.1 },
    { endpoint: '', model: '', temperature: 0.1 },
  ],
  scriptAgentSlot: 'primary',
  scriptAgent: {
    endpoint: '',
    model: '',
    temperature: 0.2,
  },
  scriptAgentBackups: [
    { endpoint: '', model: '', temperature: 0.2 },
    { endpoint: '', model: '', temperature: 0.2 },
  ],
  solutionPrompt: [
    '你是「单题板书在线答疑」的 B-A 解题 Agent。',
    '只负责独立解题、核对答案、步骤、单位、验算和不确定项。',
    '不要生成教学剧本、口播、坐标或工具动作，不要改动第1步已确认题目。',
    '只返回符合程序固定契约的 JSON，不要 markdown，不要解释。',
  ].join('\n'),
  scriptPrompt: [
    '你是「单题板书在线答疑」的 Agent B。',
    '根据第1步已确认的题目、题型、布局和真预览图，直接生成七列讲题执行表。',
    '分析区是主板书，必须把推理拆成多个教学步骤；解题区只承接规范算式、结果和答语。',
    '内部完成解题与验算，不反问、不输出待确认项、不改动第1步已确认内容。',
    '只返回符合程序固定契约的 JSON，不要 markdown，不要解释。',
  ].join('\n'),
}

function normalizeAgentConnection(value, fallback) {
  return {
    endpoint: value?.endpoint ?? fallback.endpoint,
    model: value?.model ?? fallback.model,
    temperature: Number(value?.temperature ?? fallback.temperature),
  }
}

export function resolveAgentBStageConfig(config, taskStage) {
  const isScript = taskStage === AGENT_B_STAGE.BOARD_SCRIPT
  const primaryKey = isScript ? 'scriptAgent' : 'solutionAgent'
  const slotKey = isScript ? 'scriptAgentSlot' : 'solutionAgentSlot'
  const backupsKey = isScript ? 'scriptAgentBackups' : 'solutionAgentBackups'
  const slot = AGENT_B_CONNECTION_SLOTS.includes(config?.[slotKey]) ? config[slotKey] : 'primary'
  if (slot === 'primary') {
    return normalizeAgentConnection(config?.[primaryKey], AGENT_B_DEFAULTS[primaryKey])
  }
  const index = slot === 'backup1' ? 0 : 1
  const emptyFallback = AGENT_B_DEFAULTS[backupsKey][index]
  return normalizeAgentConnection(config?.[backupsKey]?.[index], emptyFallback)
}

export function getAgentBStageConnection(config, taskStage) {
  const isScript = taskStage === AGENT_B_STAGE.BOARD_SCRIPT
  const primaryKey = isScript ? 'scriptAgent' : 'solutionAgent'
  const slotKey = isScript ? 'scriptAgentSlot' : 'solutionAgentSlot'
  const backupsKey = isScript ? 'scriptAgentBackups' : 'solutionAgentBackups'
  const slot = AGENT_B_CONNECTION_SLOTS.includes(config?.[slotKey]) ? config[slotKey] : 'primary'
  if (slot === 'primary') return config[primaryKey]
  return config[backupsKey][slot === 'backup1' ? 0 : 1]
}

export function loadAgentBConfig() {
  try {
    const raw = localStorage.getItem(AGENT_B_STORAGE_KEY)
    const step1Raw = localStorage.getItem(STEP1_AGENT_STORAGE_KEY)
    const saved = raw ? JSON.parse(raw) : {}
    const step1 = step1Raw ? JSON.parse(step1Raw) : {}
    const promptIsCurrent = saved.promptSchemaVersion === AGENT_B_PROMPT_SCHEMA_VERSION
    const connectionsAreCurrent = saved.connectionSchemaVersion === AGENT_B_CONNECTION_SCHEMA_VERSION
    const hasLegacyScriptModel = ['gpt-5.4', 'claude-opus-4-8'].includes(saved.scriptAgent?.model)
    // 旧版 step1.agentConfig 里的 endpoint/model 会被 Step1Entry.vue 迁到 userApiConfig；
    // 这里不再继承 step1/saved 的 endpoint/model，统一由 userApiConfig 提供。
    const inheritedConnection = {
      endpoint: '',
      model: '',
      temperature: Number(saved.temperature ?? 0.2),
    }
    const emptySolutionBackup = AGENT_B_DEFAULTS.solutionAgentBackups[1]
    const emptyScriptBackups = AGENT_B_DEFAULTS.scriptAgentBackups
    return {
      ...AGENT_B_DEFAULTS,
      ...saved,
      promptSchemaVersion: AGENT_B_PROMPT_SCHEMA_VERSION,
      solutionPrompt: promptIsCurrent
        ? saved.solutionPrompt || AGENT_B_DEFAULTS.solutionPrompt
        : AGENT_B_DEFAULTS.solutionPrompt,
      scriptPrompt: promptIsCurrent
        ? saved.scriptPrompt || AGENT_B_DEFAULTS.scriptPrompt
        : AGENT_B_DEFAULTS.scriptPrompt,
      legacySystemPromptBackup: promptIsCurrent
        ? saved.legacySystemPromptBackup || ''
        : saved.systemPrompt || saved.solutionPrompt || saved.scriptPrompt || saved.legacySystemPromptBackup || '',
      capability: 'multimodal',
      connectionSchemaVersion: AGENT_B_CONNECTION_SCHEMA_VERSION,
      solutionAgentSlot: connectionsAreCurrent && AGENT_B_CONNECTION_SLOTS.includes(saved.solutionAgentSlot)
        ? saved.solutionAgentSlot
        : 'primary',
      solutionAgent: normalizeAgentConnection(
        connectionsAreCurrent ? saved.solutionAgent : AGENT_B_DEFAULTS.solutionAgent,
        { ...inheritedConnection, temperature: 0.1 },
      ),
      solutionAgentBackups: connectionsAreCurrent
        ? [0, 1].map((index) => normalizeAgentConnection(saved.solutionAgentBackups?.[index], AGENT_B_DEFAULTS.solutionAgentBackups[index]))
        : [
            normalizeAgentConnection(saved.solutionAgent || inheritedConnection, { ...inheritedConnection, temperature: 0.1 }),
            { ...emptySolutionBackup },
          ],
      scriptAgentSlot: connectionsAreCurrent && AGENT_B_CONNECTION_SLOTS.includes(saved.scriptAgentSlot)
        ? saved.scriptAgentSlot
        : 'primary',
      scriptAgent: normalizeAgentConnection(
        connectionsAreCurrent && !hasLegacyScriptModel ? saved.scriptAgent : AGENT_B_DEFAULTS.scriptAgent,
        AGENT_B_DEFAULTS.scriptAgent,
      ),
      scriptAgentBackups: [0, 1].map((index) => normalizeAgentConnection(
        connectionsAreCurrent ? saved.scriptAgentBackups?.[index] : null,
        emptyScriptBackups[index],
      )),
    }
  } catch {
    return {
      ...AGENT_B_DEFAULTS,
      solutionAgent: { ...AGENT_B_DEFAULTS.solutionAgent },
      solutionAgentBackups: AGENT_B_DEFAULTS.solutionAgentBackups.map((item) => ({ ...item })),
      scriptAgent: { ...AGENT_B_DEFAULTS.scriptAgent },
      scriptAgentBackups: AGENT_B_DEFAULTS.scriptAgentBackups.map((item) => ({ ...item })),
    }
  }
}

export function saveAgentBConfig(cfg) {
  const next = {
    promptSchemaVersion: AGENT_B_PROMPT_SCHEMA_VERSION,
    pageName: cfg.pageName || AGENT_B_DEFAULTS.pageName,
    role: cfg.role || AGENT_B_DEFAULTS.role,
    capability: cfg.capability || 'multimodal',
    connectionSchemaVersion: AGENT_B_CONNECTION_SCHEMA_VERSION,
    solutionAgentSlot: AGENT_B_CONNECTION_SLOTS.includes(cfg.solutionAgentSlot) ? cfg.solutionAgentSlot : 'primary',
    solutionAgent: normalizeAgentConnection(cfg.solutionAgent, AGENT_B_DEFAULTS.solutionAgent),
    solutionAgentBackups: [0, 1].map((index) => normalizeAgentConnection(
      cfg.solutionAgentBackups?.[index],
      AGENT_B_DEFAULTS.solutionAgentBackups[index],
    )),
    scriptAgentSlot: AGENT_B_CONNECTION_SLOTS.includes(cfg.scriptAgentSlot) ? cfg.scriptAgentSlot : 'primary',
    scriptAgent: normalizeAgentConnection(cfg.scriptAgent, AGENT_B_DEFAULTS.scriptAgent),
    scriptAgentBackups: [0, 1].map((index) => normalizeAgentConnection(
      cfg.scriptAgentBackups?.[index],
      AGENT_B_DEFAULTS.scriptAgentBackups[index],
    )),
    solutionPrompt: cfg.solutionPrompt || AGENT_B_DEFAULTS.solutionPrompt,
    scriptPrompt: cfg.scriptPrompt || AGENT_B_DEFAULTS.scriptPrompt,
    legacySystemPromptBackup: cfg.legacySystemPromptBackup || '',
  }
  localStorage.setItem(AGENT_B_STORAGE_KEY, JSON.stringify(next))
  return next
}

/**
 * 若我是 Agent B，开工前必须齐的材料清单
 */
export function inspectAgentBReadiness({
  taskStage = AGENT_B_STAGE.SOLUTION_DRAFT,
  config,
  handoff,
  boardPlan,
  previewDataUrl,
  rowsCount,
} = {}) {
  const checks = []
  const ok = (id, pass, need, have) => checks.push({ id, pass: Boolean(pass), need, have })
  const stageConfig = resolveAgentBStageConfig(config, taskStage)

  ok('problemText', Boolean(handoff?.problemText?.trim()), '题目正文', handoff?.problemText ? '有' : '无')
  ok('problemType', Boolean(handoff?.problemType), '题型 geometry|calculation|word', handoff?.problemType || '无')
  ok('boardFocus', Boolean(handoff?.boardFocus), '板书侧重', handoff?.boardFocus || '无')
  ok('topicAnchor', Boolean(handoff?.topicLayout?.question || boardPlan?.question), '第1步题目坐标锚', '有/可推算')
  ok('boardPlan', Boolean(boardPlan?.analysisLabel && boardPlan?.solutionLabel && boardPlan?.summaryLabel), '四标签规划', boardPlan?.method || (boardPlan ? '部分' : '无'))
  ok('preview', Boolean(previewDataUrl), '真画布预览图（多模态必看）', previewDataUrl ? '已截取' : '未截取')
  ok('capability', config?.capability === 'multimodal', '多模态能力', config?.capability || '无')
  // endpoint/model/apiKey 全部来自全局 userApiConfig（用户在前端统一填写）
  const userSnap = getUserApiSnapshot()
  ok('model', Boolean(userSnap.model), '生成模型（多模态，如 gpt-5.6-terra）', userSnap.model || '未填')
  ok('endpoint', /^https?:\/\//.test(userSnap.endpoint || ''), '服务 Endpoint', userSnap.endpoint ? '已配置' : '未填')
  ok('apiKey', Boolean(userSnap.apiKey), '用户 API Key（前端填写）', userSnap.apiKey ? '已填写' : '未填')
  const stagePrompt = taskStage === AGENT_B_STAGE.BOARD_SCRIPT
    ? config?.scriptPrompt
    : config?.solutionPrompt
  const promptReady = Boolean(stagePrompt?.trim())
    && ['solutionCheck', 'duration', 'speech', 'analysisBoard', 'solutionBoard', 'actionSpec']
      .every((key) => AGENT_B_FOUNDATION_PROMPT.includes(key))
  ok('systemPrompt', promptReady, '新B任务提示词 + 不可覆盖输出契约', promptReady ? '已配置' : '不完整')

  const missing = checks.filter((c) => !c.pass)
  return {
    ready: missing.length === 0,
    score: `${checks.filter((c) => c.pass).length}/${checks.length}`,
    checks,
    missing,
    rowsCount: rowsCount || 0,
  }
}

/**
 * 组装发给 Agent B 的完整请求包（文本部分；图另附 image）
 */
export function buildAgentBUserPayload({
  taskStage = AGENT_B_STAGE.SOLUTION_DRAFT,
  handoff,
  boardPlan,
  handwritingFontId,
  confirmedSolution,
  solutionConfirmed = false,
  extraNote = '',
} = {}) {
  const h = handoff || {}
  const basePayload = {
    taskStage,
    task: taskStage === AGENT_B_STAGE.BOARD_SCRIPT
      ? 'generate_board_script_7col'
      : 'solve_problem_draft',
    problemText: h.problemText || '',
    problemType: h.problemType || '',
    boardFocus: h.boardFocus || '',
    imageKind: h.imageKind || 'text_only',
    keepOriginal: Boolean(h.keepOriginal),
    canvas: h.canvas || { w: CANVAS_W, h: CANVAS_H, unit: 'px' },
    topicLayout: h.topicLayout || null,
    boardPlan: boardPlan || h.boardPlan || null,
    teachingStrategy: resolveAgentBTeachingStrategy({
      problemType: h.problemType,
      boardFocus: h.boardFocus,
    }),
    relatedKnowledge: selectAgentBRelatedKnowledge({
      problemText: h.problemText,
      problemType: h.problemType,
    }),
    knowledgeInstruction: '关联知识只用于拆解分析步骤、补充知识依据和易错提醒；不得覆盖已确认题目，不得机械照抄无关内容。',
    previewInstruction: taskStage === AGENT_B_STAGE.BOARD_SCRIPT
      ? '附件是当前真画布预览图。只为分析区/解题区动作判断分区与落点；RoughNotation 按文本定位。不得改动题目区。'
      : '附件是当前真画布预览图。只用于核对已确认题意与图形关系；本阶段不要写坐标、板书动作或工具调用。',
    extraNote: extraNote || '',
  }
  if (taskStage !== AGENT_B_STAGE.BOARD_SCRIPT) {
    return {
      ...basePayload,
      outputObject: 'solutionCheck',
    }
  }
  return {
    ...basePayload,
    confirmedSolution,
    outputColumns: AGENT_B_OUTPUT_COLUMNS,
    availableBoardTools: getAgentBoardToolCatalog(),
    boardTypography: getAgentBoardTypographyPolicy(handwritingFontId),
    speechPolicy: getAgentBSpeechPolicy(),
    boardMathPolicy: getAgentBBoardMathPolicy(),
  }
}

/**
 * 调用本地代理生成（与第1步同 key 体系；需 vite 代理）
 * previewDataUrl: 预览图 dataURL，多模态必传
 */
async function requestAgentBStage({
  taskStage,
  config,
  handoff,
  boardPlan,
  previewDataUrl,
  handwritingFontId,
  confirmedSolution,
  solutionConfirmed = false,
  extraNote = '',
} = {}) {
  const readiness = inspectAgentBReadiness({
    taskStage,
    config,
    handoff,
    boardPlan,
    previewDataUrl,
  })
  if (!handoff?.problemText?.trim()) {
    throw new Error('缺少题目正文：Agent B 无法开写')
  }
  if (!previewDataUrl) {
    throw new Error('缺少真画布预览图：Agent B 必须看见页面预览才能定坐标')
  }
  if (!readiness.ready) {
    throw new Error(`Agent B 开工材料不齐：${readiness.missing.map((item) => item.need).join('、')}`)
  }

  const userPayload = buildAgentBUserPayload({
    taskStage,
    handoff,
    boardPlan,
    handwritingFontId,
    confirmedSolution,
    solutionConfirmed,
    extraNote,
  })
  const stageConfig = resolveAgentBStageConfig(config, taskStage)
  // endpoint/model 优先用本线 stageConfig（用户在 BoardParamDraft 里可单独配置），
  // 若本线未填则回退到全局 userApiConfig（与第1步、新线共享同一份凭证）。
  const userSnap = getUserApiSnapshot()
  const finalEndpoint = stageConfig.endpoint || userSnap.endpoint
  const finalModel = stageConfig.model || userSnap.model
  const finalApiKey = userSnap.apiKey
  if (!finalApiKey) {
    throw new Error('缺少 apiKey：请先在前端「Agent 配置」里填写用户自己的 API Key')
  }
  if (!finalEndpoint) {
    throw new Error('缺少 endpoint：请先在前端「Agent 配置」里填写上游 API URL')
  }
  if (!finalModel) {
    throw new Error('缺少 model：请先在前端「Agent 配置」里填写支持多模态的模型名（如 gpt-5.6-terra）')
  }
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), AGENT_B_REQUEST_TIMEOUT_MS)
  let response
  let data
  try {
    response = await fetch('/api/agent-b/board-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        endpoint: finalEndpoint,
        model: finalModel,
        apiKey: finalApiKey,
        temperature: stageConfig.temperature,
        systemPrompt: `${taskStage === AGENT_B_STAGE.BOARD_SCRIPT
          ? config?.scriptPrompt || AGENT_B_DEFAULTS.scriptPrompt
          : config?.solutionPrompt || AGENT_B_DEFAULTS.solutionPrompt}\n\n${getAgentBFoundationPrompt(taskStage)}`,
        userPayload,
        previewDataUrl,
      }),
    })
    data = await response.json().catch(() => ({}))
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Agent B 请求超过65秒，已取消')
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Agent B 生成失败 ${response.status}`)
  }
  return {
    data,
    teachingStrategy: userPayload.teachingStrategy,
    model: data.model,
    rawText: data.rawText || '',
    readiness,
  }
}

export async function generateAgentBSolutionDraft(options = {}) {
  const result = await requestAgentBStage({ ...options, taskStage: AGENT_B_STAGE.SOLUTION_DRAFT })
  const solutionResult = validateAgentBSolutionCheck(result.data.solutionCheck)
  if (!solutionResult.ok) throw new Error(solutionResult.error)
  return {
    ...result,
    solutionCheck: solutionResult.value,
    blockedByUncertainty: solutionResult.value.uncertainItems.length > 0,
  }
}

export async function generateAgentBBoardScript(options = {}) {
  const result = await requestAgentBStage({ ...options, taskStage: AGENT_B_STAGE.BOARD_SCRIPT })
  const contractResult = validateAgentBRowsContract(result.data.rows)
  if (!contractResult.ok) throw new Error(contractResult.error)
  const rows = applyEstimatedSpeechTimeline(
    validateAgentBActionSpecs(
      validateAgentBBoardRows(contractResult.value),
    ),
  )
  if (!rows.length) throw new Error('Agent B 未返回七列表剧本')
  return { ...result, rows }
}
