/* @qh-core LANE=STEP1 POINT=HANDOFF_OWNER localStorage snapshot to step2 */
/**
 * 第1步 → 板书参数书稿页 交接
 * 信号：用户点击「确定进入生成表」
 * 核心：题目内容、题型、板书侧重 + 第1步已定题目坐标
 */
import { CANVAS_W, CANVAS_H } from '../utils/canvasCoords.js'
export const STEP1_HANDOFF_KEY = 'qinghuabu.step1.toBoardDraft.handoff'
export const STEP1_HANDOFF_EVENT = 'qinghuabu:step1-handoff'

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeTree)
  return Object.freeze(value)
}

function sanitizeHandoff(payload) {
  const copy = JSON.parse(JSON.stringify(payload || {}))
  const columns = copy?.forBoardDraftAgent?.tableColumns
  if (Array.isArray(columns)) {
    copy.forBoardDraftAgent.tableColumns = columns.filter((column) => column !== 'fontOrLib')
  }
  return freezeTree(copy)
}

export function buildStep1Handoff(input = {}) {
  const problemText = String(input.problemText || '').trim()
  const problemType = input.problemType || null
  const boardFocus = input.boardFocus || null
  const imageKind = input.imageKind || (input.keepOriginal ? 'has_diagram' : 'text_only')
  const topicLayout = input.topicLayout || null
  const relatedKnowledge = Array.isArray(input.relatedKnowledge)
    ? JSON.parse(JSON.stringify(input.relatedKnowledge))
    : null
  const previewDataUrl = String(input.previewDataUrl || '')

  return {
    confirmedAt: new Date().toISOString(),
    problemText,
    problemType,
    boardFocus,
    relatedKnowledge,
    imageKind,
    keepOriginal: Boolean(input.keepOriginal),
    sourceImageDataUrl: input.keepOriginal ? input.sourceImageDataUrl || '' : '',
    canvas: { w: CANVAS_W, h: CANVAS_H, unit: 'px' },
    topicLayout,
    boardPlan: input.boardPlan || null,
    showGrid: Boolean(input.showGrid),
    previewDataUrl,
  }
}

export function isCompleteStep1Handoff(handoff) {
  const plan = handoff?.boardPlan
  return Boolean(
    handoff?.problemText?.trim()
    && handoff?.problemType
    && handoff?.boardFocus
    && handoff?.showGrid === true
    && handoff?.previewDataUrl
    && plan?.question
    && plan?.analysis
    && plan?.solution
    && plan?.summary
  )
}

export function saveStep1Handoff(payload) {
  const approved = sanitizeHandoff(payload)
  localStorage.setItem(STEP1_HANDOFF_KEY, JSON.stringify(approved))
  window.dispatchEvent(new CustomEvent(STEP1_HANDOFF_EVENT, { detail: approved }))
  return approved
}


export function readStep1Handoff() {
  try {
    const raw = localStorage.getItem(STEP1_HANDOFF_KEY)
    return raw ? sanitizeHandoff(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function clearStep1Handoff() {
  localStorage.removeItem(STEP1_HANDOFF_KEY)
}
