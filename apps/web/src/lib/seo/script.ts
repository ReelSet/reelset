export type ScriptParts = {
  hook: string | null
  transcript: string | null
  claims: { text: string; chunkIds: string[] }[]
}

const EMPTY: ScriptParts = { hook: null, transcript: null, claims: [] }

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Hook, spoken narration and cited claims from `item.script`, tolerant of older script versions. */
export function scriptParts(raw: unknown): ScriptParts {
  if (!raw || typeof raw !== 'object') return EMPTY
  const script = raw as Record<string, unknown>
  const hook = text(script.hook)
  const beats = Array.isArray(script.beats)
    ? script.beats.map((b) => text((b as Record<string, unknown> | null)?.text))
    : []
  const spoken = [hook, ...beats, text(script.outro)].filter((t): t is string => t !== null)
  const claims = Array.isArray(script.claims)
    ? script.claims.flatMap((c) => {
        const claim = c as Record<string, unknown> | null
        const claimText = text(claim?.text)
        const ids = Array.isArray(claim?.chunkIds)
          ? claim.chunkIds.filter((id): id is string => typeof id === 'string')
          : []
        return claimText ? [{ text: claimText, chunkIds: ids }] : []
      })
    : []
  return { hook, transcript: spoken.length ? spoken.join(' ') : null, claims }
}
