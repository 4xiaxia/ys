import { validateAgentBSolutionCheck } from './agentBDraftResult.js'

export const STEP2_PHASE = {
  SOLUTION_SETUP: 'solution-setup',
  SOLUTION_GENERATING: 'solution-generating',
  SOLUTION_REVIEW: 'solution-review',
  SOLUTION_CONFIRMED: 'solution-confirmed',
  SCRIPT_GENERATING: 'script-generating',
  SCRIPT_REVIEW: 'script-review',
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map((item) => deepClone(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepClone(item)]),
    )
  }
  return value
}

function cloneSolutionFields(solutionCheck) {
  return {
    answer: deepClone(solutionCheck?.answer ?? ''),
    steps: deepClone(solutionCheck?.steps ?? []),
    unitCheck: deepClone(solutionCheck?.unitCheck ?? ''),
    verification: deepClone(solutionCheck?.verification ?? ''),
    uncertainItems: deepClone(solutionCheck?.uncertainItems ?? []),
  }
}

export function deriveStep2Phase({
  solutionCheck,
  confirmedSolution,
  rows,
  generationStage,
  generationState,
} = {}) {
  if (generationState === 'loading') {
    return generationStage === 'script'
      ? STEP2_PHASE.SCRIPT_GENERATING
      : STEP2_PHASE.SOLUTION_GENERATING
  }
  if (Array.isArray(rows) && rows.length) return STEP2_PHASE.SCRIPT_REVIEW
  if (confirmedSolution) return STEP2_PHASE.SOLUTION_CONFIRMED
  if (solutionCheck) return STEP2_PHASE.SOLUTION_REVIEW
  return STEP2_PHASE.SOLUTION_SETUP
}

export function createSolutionReviewDraft(solutionCheck) {
  if (!solutionCheck) return null
  const draft = cloneSolutionFields(solutionCheck)
  return {
    ...draft,
    originalUncertainItems: deepClone(draft.uncertainItems),
  }
}

export function validateSolutionReviewDraft(reviewDraft, resolutionNote) {
  const validation = validateAgentBSolutionCheck({
    answer: reviewDraft?.answer,
    steps: Array.isArray(reviewDraft?.steps) ? reviewDraft.steps : [],
    unitCheck: reviewDraft?.unitCheck,
    verification: reviewDraft?.verification,
    uncertainItems: Array.isArray(reviewDraft?.uncertainItems)
      ? reviewDraft.uncertainItems
      : [],
  })
  if (!validation.ok) return { ok: false, error: validation.error }

  const originalUncertainItems = Array.isArray(reviewDraft?.originalUncertainItems)
    ? reviewDraft.originalUncertainItems
    : []
  const hasUncertainty = originalUncertainItems.length || validation.value.uncertainItems.length
  if (hasUncertainty && !String(resolutionNote ?? '').trim()) {
    return { ok: false, error: '存在待确认项时必须填写处理说明' }
  }
  return { ok: true }
}

export function createConfirmedSolutionSnapshot(
  reviewDraft,
  { resolutionNote, confirmedAt } = {},
) {
  const validation = validateSolutionReviewDraft(reviewDraft, resolutionNote)
  if (!validation.ok) throw new Error(validation.error)

  const snapshot = cloneSolutionFields(reviewDraft)
  snapshot.uncertainItems = []
  snapshot.reviewMeta = {
    originalUncertainItems: deepClone(reviewDraft.originalUncertainItems ?? []),
    resolutionNote: String(resolutionNote ?? '').trim(),
    confirmedAt: deepClone(confirmedAt ?? ''),
  }
  return snapshot
}
