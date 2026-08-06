/* @qh-core LANE=B-V2 POINT=TIMING 170cpm phase-local display + global for render */
export const AGENT_B_V2_SPEECH_RATE = 170
export const AGENT_B_V2_ROW_GAP_MS = 1500

// 四大阶段映射：题目=读题，分析，解答/答语=解答，总结
const BIG_PHASE_MAP = {
  题目: '读题',
  分析: '分析',
  解答: '解答',
  答语: '解答',
  总结: '总结',
}

function getBigPhase(stage) {
  return BIG_PHASE_MAP[String(stage || '')] ?? String(stage || '')
}

function normalizeSpeech(speech) {
  return String(speech || '')
    .replaceAll('【点击生成语音】', '')
    .trim()
}

function countCharacters(speech) {
  return [...normalizeSpeech(speech).replace(/\s+/g, '')].length
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function applyAgentBV2Timeline(rows) {
  let globalCursorMs = 0   // 全局累计，供渲染管线使用
  let phaseCursorMs = 0    // 阶段内局部，供表格时间列显示
  let currentPhase = null

  return rows.map((row) => {
    const phase = getBigPhase(row.stage)

    // 大阶段切换时重置局部计时器
    if (phase !== currentPhase) {
      currentPhase = phase
      phaseCursorMs = 0
    }

    const speech = normalizeSpeech(row.speech)
    const speechCharacters = countCharacters(speech)
    const estimatedDurationMs = Math.max(1000, Math.round(speechCharacters * 60000 / AGENT_B_V2_SPEECH_RATE))

    const estimatedStartMs = globalCursorMs
    const estimatedEndMs = estimatedStartMs + estimatedDurationMs
    globalCursorMs = estimatedEndMs + AGENT_B_V2_ROW_GAP_MS

    const phaseLocalStartMs = phaseCursorMs
    const phaseLocalEndMs = phaseLocalStartMs + estimatedDurationMs
    phaseCursorMs = phaseLocalEndMs + AGENT_B_V2_ROW_GAP_MS

    return {
      ...row,
      speech,
      duration: `预计 ${formatClock(phaseLocalStartMs)}—${formatClock(phaseLocalEndMs)}`,
      timingStatus: 'estimated',
      timingSource: 'agent-b-v2-170-cpm',
      timingPhase: phase,
      speechCharacters,
      estimatedDurationMs,
      estimatedStartMs,    // 全局绝对起点（渲染用）
      estimatedEndMs,      // 全局绝对终点（渲染用）
      phaseLocalStartMs,   // 阶段内局部起点
      phaseLocalEndMs,     // 阶段内局部终点
    }
  })
}
