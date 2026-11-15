import {
  GATE_RATIONALE_MAX_CHARS,
  GATE_REASON_MAX_CHARS,
  GATE_SIGNAL_KEYS,
  parseGateSignals,
  type GateSignals,
} from '@reelset/core'
import { GATE_PROMPT_REASONS_MAX } from '../config'

export type GateJudgement = { signals: GateSignals; reasons: string[]; rationale: string }

export type ParsedGateOutput = { ok: true; value: GateJudgement } | { ok: false; reason: string }

/** Fewer marked signals than this is too little to score on, so the answer counts as malformed. */
export const GATE_MIN_MARKED_SIGNALS = Math.ceil(GATE_SIGNAL_KEYS.length / 2)

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

function numericMarks(raw: unknown): Obj {
  if (!isObj(raw)) return {}
  const marks: Obj = {}
  for (const [key, value] of Object.entries(raw)) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    marks[key] = typeof number === 'number' ? Math.round(number) : number
  }
  return marks
}

function shortReasons(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((reason): reason is string => typeof reason === 'string')
    .map((reason) => reason.trim().slice(0, GATE_REASON_MAX_CHARS))
    .filter(Boolean)
    .slice(0, GATE_PROMPT_REASONS_MAX)
}

/** Reads the judge's answer: marks are rounded and clamped to 0..10, unknown or missing signals dropped, text cut to size. */
export function parseGateOutput(text: string): ParsedGateOutput {
  const json = extractJson(text)
  if (!isObj(json)) return { ok: false, reason: 'response was not a JSON object' }
  const signals = parseGateSignals(numericMarks(json.signals))
  const marked = Object.keys(signals).length
  if (marked < GATE_MIN_MARKED_SIGNALS) {
    return { ok: false, reason: `only ${marked} of ${GATE_SIGNAL_KEYS.length} signals were marked` }
  }
  const rationale =
    typeof json.rationale === 'string'
      ? json.rationale.trim().slice(0, GATE_RATIONALE_MAX_CHARS)
      : ''
  return { ok: true, value: { signals, reasons: shortReasons(json.reasons), rationale } }
}
