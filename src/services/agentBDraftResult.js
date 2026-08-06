function parseJsonCandidate(text) {
  if (!text) return null
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || String(text)).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const objectStart = candidate.indexOf('{')
    const objectEnd = candidate.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) {
      try { return JSON.parse(candidate.slice(objectStart, objectEnd + 1)) } catch {}
    }
    const arrayStart = candidate.indexOf('[')
    const arrayEnd = candidate.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try { return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1)) } catch {}
    }
    return null
  }
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function normalizeActionSpec(value) {
  if (value == null || value === '') return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const normalized = {
      ...row,
      key: row.key || `gen-${index + 1}`,
    }
    if (Object.hasOwn(row, 'actionSpec')) normalized.actionSpec = normalizeActionSpec(row.actionSpec)
    return normalized
  })
}

function normalizeSolutionCheck(value) {
  if (!value || typeof value !== 'object') return null
  return {
    answer: String(value.answer || '').trim(),
    steps: normalizeStringArray(value.steps),
    unitCheck: String(value.unitCheck || '').trim(),
    verification: String(value.verification || '').trim(),
    uncertainItems: normalizeStringArray(value.uncertainItems),
  }
}

export function parseAgentBDraftText(text) {
  const parsed = parseJsonCandidate(text)
  if (Array.isArray(parsed)) {
    return { solutionCheck: null, rows: [], contractError: 'Agent B 顶层必须返回 {"rows":[...]}' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { solutionCheck: null, rows: [], contractError: 'Agent B 返回内容不是有效 JSON 对象' }
  }
  return {
    solutionCheck: normalizeSolutionCheck(parsed.solutionCheck),
    rows: normalizeRows(parsed.rows),
    contractError: Object.hasOwn(parsed, 'rows') && !Array.isArray(parsed.rows)
      ? 'Agent B 的 rows 必须是数组'
      : '',
  }
}

export function validateAgentBSolutionCheck(solutionCheck) {
  if (!solutionCheck) return { ok: false, error: 'Agent B 缺少 solutionCheck 解题核验结果' }
  if (!solutionCheck.answer) return { ok: false, error: 'solutionCheck.answer 不能为空' }
  if (!solutionCheck.steps.length) return { ok: false, error: 'solutionCheck.steps 至少需要一个可核验步骤' }
  if (!solutionCheck.unitCheck) return { ok: false, error: 'solutionCheck.unitCheck 必须说明单位检查或明确“无单位”' }
  return { ok: true, value: solutionCheck }
}
