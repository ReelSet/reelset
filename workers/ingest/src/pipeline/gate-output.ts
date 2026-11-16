import { GATE_RATIONALE_MAX_CHARS, GATE_REASON_MAX_CHARS, GATE_SCORE_MAX } from '@reelset/core'
import { GATE_PROMPT_REASONS_MAX } from '../config'

/** The judge's one holistic rating (0..100) of how well a reel from this source would hold viewers, with its reasons. */
export type GateJudgement = { score: number; reasons: string[]; rationale: string }

export type ParsedGateOutput = { ok: true; value: GateJudgement } | { ok: false; reason: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// The model sometimes wraps the object in a fence or a sentence; take the outermost braces.
function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

// Accepts 72, 72.4 and "72"; anything that is not a number is no rating at all.
function readScore(raw: unknown): number | null {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(GATE_SCORE_MAX, Math.max(0, Math.round(value)))
}

function shortReasons(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((reason): reason is string => typeof reason === 'string')
    .map((reason) => reason.trim().slice(0, GATE_REASON_MAX_CHARS))
    .filter(Boolean)
    .slice(0, GATE_PROMPT_REASONS_MAX)
}

/** Reads the judge's answer: one rating rounded and clamped to 0..100, reasons and rationale cut to size. No usable rating means malformed. */
export function parseGateOutput(text: string): ParsedGateOutput {
  const json = extractJson(text)
  if (!isObj(json)) return { ok: false, reason: 'response was not a JSON object' }
  const score = readScore(json.score)
  if (score === null) return { ok: false, reason: 'the answer had no numeric score' }
  const rationale =
    typeof json.rationale === 'string'
      ? json.rationale.trim().slice(0, GATE_RATIONALE_MAX_CHARS)
      : ''
  return { ok: true, value: { score, reasons: shortReasons(json.reasons), rationale } }
}
