/* @qh-core LANE=B-V2 POINT=CLIENT_GENERATE buildPayload+fetch /api/agent-b-v2/generate
 * apiKey 由用户在前端填写，统一存于 userApiConfig（localStorage key: qinghuabu.userApiConfig.v1）。
 * endpoint / model / temperature 仍由本服务的 localStorage 维护（用于和现有 UI 解耦）。
 */
import { getAgentBDirectorView } from '../board-tools/boardToolCatalog.js'
import { CANVAS_W, CANVAS_H } from '../utils/canvasCoords.js'
import { getAgentBoardTypographyPolicy } from '../board-tools/boardTypography.js'
import { selectAgentBRelatedKnowledge } from '../services/agentBKnowledge.js'
import { resolveAgentBTeachingStrategy } from '../services/agentBStrategies.js'
import { validateAgentBBoardRows } from '../services/boardMathPolicy.js'
import { getAgentBSpeechPolicy } from '../services/speechTiming.js'
import { getQhIdbRecord, putQhIdbRecord } from '../lib/simpleIndexedDb.js'
import { normalizeAgentBV2BoardCells, validateAgentBV2Rows } from './contract.js'
import { applyAgentBV2Timeline } from './timing.js'
import { getUserApiSnapshot } from '../lib/userApiConfig.js'

export const AGENT_B_V2_CONFIG_KEY = 'qinghuabu.agentB.v2.config'
export const AGENT_B_V2_ROWS_KEY = 'qinghuabu.agentB.v2.rows.v3'
export const AGENT_B_V2_IDB_CONFIG_KEY = 'agent-b-v2.config'
export const AGENT_B_V2_IDB_ROWS_KEY = 'agent-b-v2.rows'

/**
 * Agent B 新线本地配置默认值。
 * endpoint/model 默认空，由全局 userApiConfig 提供实际值；
 * 这里只保留 temperature 作为本线本地偏好。
 */
export const AGENT_B_V2_DEFAULT_CONFIG = Object.freeze({
  endpoint: '',
  model: '',
  temperature: 0.5,
})

function normalizeConfig(value = {}) {
  return {
    endpoint: String(value.endpoint || AGENT_B_V2_DEFAULT_CONFIG.endpoint).trim(),
    model: String(value.model || AGENT_B_V2_DEFAULT_CONFIG.model).trim(),
    temperature: Number.isFinite(Number(value.temperature)) ? Number(value.temperature) : 0.2,
  }
}

export function loadAgentBV2Config() {
  try {
    return normalizeConfig(JSON.parse(localStorage.getItem(AGENT_B_V2_CONFIG_KEY) || '{}'))
  } catch {
    return { ...AGENT_B_V2_DEFAULT_CONFIG }
  }
}

export function saveAgentBV2Config(config) {
  const value = normalizeConfig(config)
  localStorage.setItem(AGENT_B_V2_CONFIG_KEY, JSON.stringify(value))
  return value
}

export async function saveAgentBV2ConfigToIdb(config, options = {}) {
  const value = normalizeConfig(config)
  return putQhIdbRecord(AGENT_B_V2_IDB_CONFIG_KEY, value, options)
}

export async function loadAgentBV2ConfigFromIdb(options = {}) {
  const record = await getQhIdbRecord(AGENT_B_V2_IDB_CONFIG_KEY, options)
  return record?.value || null
}

export function isAgentBV2HandoffReady(handoff) {
  const plan = handoff?.boardPlan
  return Boolean(
    handoff?.problemText?.trim()
    && handoff?.problemType
    && handoff?.boardFocus
    && plan?.question
    && plan?.analysis
    && plan?.solution
    && plan?.summary,
  )
}

function buildPayload({ handoff, fontId, extraNote, currentTime }) {
  const relatedKnowledge = Array.isArray(handoff.relatedKnowledge)
    ? handoff.relatedKnowledge
    : selectAgentBRelatedKnowledge({
        problemText: handoff.problemText,
        problemType: handoff.problemType,
      })

  return {
    task: 'generate_agent_b_v2_seven_column_rows',
    problemText: handoff.problemText,
    problemType: handoff.problemType,
    boardFocus: handoff.boardFocus,
    imageKind: handoff.imageKind || 'text_only',
    keepOriginal: Boolean(handoff.keepOriginal),
    canvas: handoff.canvas || { w: CANVAS_W, h: CANVAS_H, unit: 'px' },
    topicLayout: handoff.topicLayout || null,
    boardPlan: handoff.boardPlan,
    teachingStrategy: resolveAgentBTeachingStrategy({
      problemType: handoff.problemType,
      boardFocus: handoff.boardFocus,
    }),
    relatedKnowledge,
    relatedKnowledgeUsage: '这些是思路与参考素材，不是唯一答案；请结合题目和真画布预览自行判断、按需使用。',
    currentTime,
    availableBoardTools: getAgentBDirectorView(),
    selectedBoardTypography: getAgentBoardTypographyPolicy(fontId),
    speechPolicy: getAgentBSpeechPolicy(),
    extraNote: String(extraNote || '').trim(),
  }
}

export async function generateAgentBV2Rows({ config, handoff, previewDataUrl, fontId, extraNote = '', currentTime }) {
  if (!isAgentBV2HandoffReady(handoff)) throw new Error('第1步交接不完整：题目、题型、板书侧重和四区布局必须先确认')

  const activeConfig = saveAgentBV2Config(config)
  const resolvedPreview = previewDataUrl || handoff.previewDataUrl
  if (!resolvedPreview) {
    console.warn('[AgentBV2] 无真画布预览图，AI将无法看到当前画面，生成质量可能降低')
  }
  // endpoint/model/apiKey 全部由全局 userApiConfig 提供（用户在前端统一填写）。
  // 本地 activeConfig 只保留 temperature 作为本线偏好。
  const userSnap = getUserApiSnapshot()
  if (!userSnap.apiKey) {
    throw new Error('缺少 apiKey：请先在前端「Agent 配置」里填写用户自己的 API Key')
  }
  if (!userSnap.endpoint) {
    throw new Error('缺少 endpoint：请先在前端「Agent 配置」里填写上游 API URL')
  }
  if (!userSnap.model) {
    throw new Error('缺少 model：请先在前端「Agent 配置」里填写支持多模态的模型名（如 gpt-5.6-terra）')
  }
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 95000)
  let response
  let data
  try {
    response = await fetch('/api/agent-b-v2/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        // 只透传 temperature；endpoint/model/apiKey 全部走 userApiConfig
        temperature: activeConfig.temperature,
        endpoint: userSnap.endpoint,
        model: userSnap.model,
        apiKey: userSnap.apiKey,
        previewDataUrl: previewDataUrl || handoff.previewDataUrl,
        userPayload: buildPayload({
          handoff,
          fontId,
          extraNote,
          currentTime: currentTime || new Date().toISOString(),
        }),
      }),
    })
    data = await response.json().catch(() => ({}))
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Agent B 请求超过 95 秒，已取消')
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (!response.ok || !data.ok) throw new Error(data.error || `Agent B 生成失败 ${response.status}`)
  const contract = validateAgentBV2Rows(data.rows, { problemType: handoff.problemType })
  if (!contract.ok) throw new Error(contract.error)
  // 板书数学规则默认软校验：提示不卡死，保证七列表能出
  const validated = validateAgentBBoardRows(contract.value, { hardFail: false })
  const rows = applyAgentBV2Timeline(validated)
  return {
    rows,
    model: data.model || activeConfig.model,
    usage: data.usage || null,
    boardMathWarnings: validated.__boardMathWarnings || [],
  }
}

export function saveAgentBV2Rows(handoff, rows) {
  const payload = {
    version: 1,
    problemText: handoff?.problemText || '',
    handoffConfirmedAt: handoff?.confirmedAt || '',
    rows: normalizeAgentBV2BoardCells(rows),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(AGENT_B_V2_ROWS_KEY, JSON.stringify(payload))
  return payload
}

export async function saveAgentBV2RowsToIdb(handoff, rows, options = {}) {
  const plainRows = JSON.parse(JSON.stringify(normalizeAgentBV2BoardCells(rows)))
  const payload = {
    version: 1,
    problemText: handoff?.problemText || '',
    handoffConfirmedAt: handoff?.confirmedAt || '',
    rows: plainRows,
    updatedAt: options.now ? options.now() : new Date().toISOString(),
  }
  return putQhIdbRecord(AGENT_B_V2_IDB_ROWS_KEY, payload, options)
}

export function loadAgentBV2Rows(handoff) {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_B_V2_ROWS_KEY) || 'null')
    if (!saved || saved.problemText !== handoff?.problemText) return []
    if (saved.handoffConfirmedAt && saved.handoffConfirmedAt !== handoff?.confirmedAt) return []
    return normalizeAgentBV2BoardCells(saved.rows)
  } catch {
    return []
  }
}

export async function loadAgentBV2RowsFromIdb(handoff, options = {}) {
  const record = await getQhIdbRecord(AGENT_B_V2_IDB_ROWS_KEY, options)
  const saved = record?.value
  if (!saved || saved.problemText !== handoff?.problemText) return []
  if (saved.handoffConfirmedAt && saved.handoffConfirmedAt !== handoff?.confirmedAt) return []
  return normalizeAgentBV2BoardCells(saved.rows)
}
