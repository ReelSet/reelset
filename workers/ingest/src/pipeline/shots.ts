import { SCREEN_NAMES, SFX_NAMES } from '@reelset/core'
import { groundLabel, type Ledger } from './stat-labels'
import {
  findQuantities,
  isCompleteCodeLine,
  isQuantityValue,
  keyPointText,
  quantityValue,
} from './text-rules'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export const MAX_HEADLINE_WORDS = 7
export const MAX_SHOTS_PER_BEAT = 4
/** Labels into the parsed paper ('Table 2', '(3)'); resolved to real props later, never numeric claims. */
const PAPER_REF_KEYS = new Set(['table', 'figure', 'equation'])
export const MAX_NARRATION_WORDS = 135

const NUM_RE = /\d[\d,]*(?:\.\d+)?\s?(?:[kKmMbB]\b)?/g
const SCREENS = new Set<string>(SCREEN_NAMES)
const SFX = new Set<string>(SFX_NAMES)

function norm(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Numeric values mentioned in text, so "12,000", "12000" and "12k" count as the same fact. */
export function numberValues(text: string): Set<number> {
  const out = new Set<number>()
  for (const m of text.matchAll(NUM_RE)) {
    const raw = m[0].replace(/,/g, '').replace(/\s/g, '')
    const suffix = /[kKmMbB]$/.exec(raw)?.[0]?.toLowerCase()
    const base = Number.parseFloat(raw)
    if (Number.isNaN(base)) continue
    const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1
    out.add(Math.round(base * mult * 1000) / 1000)
  }
  return out
}

function propIsGrounded(value: unknown, facts: ReadonlySet<number>): boolean {
  if (typeof value === 'number') return facts.has(value)
  if (typeof value === 'string') return [...numberValues(value)].every((n) => facts.has(n))
  if (Array.isArray(value)) return value.every((v) => propIsGrounded(v, facts))
  if (isObj(value)) return Object.values(value).every((v) => propIsGrounded(v, facts))
  return true
}

/** Whether the nth occurrence of a word cue ('word' or 'word#n') exists in the beat text. */
export function cueExists(cue: string, text: string): boolean {
  const m = /^([^#\s]+)(?:#([1-9]))?$/.exec(cue.trim())
  if (!m?.[1]) return false
  const target = norm(m[1])
  if (!target) return false
  const nth = Number(m[2] ?? 1)
  return text.split(/\s+/).filter((w) => norm(w) === target).length >= nth
}

export function clipHeadline(headline: unknown): string | undefined {
  if (typeof headline !== 'string') return undefined
  const words = headline
    .trim()
    .replace(/[.!]+$/, '')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return undefined
  return words.slice(0, MAX_HEADLINE_WORDS).join(' ').slice(0, 60).trim()
}

/**
 * Keeps only shots that can be rendered truthfully: known screen, a cue word that is really in the
 * beat text (in order, at least one word apart), and props whose numbers all appear in the source
 * facts. A shot whose numeric props are all ungrounded is dropped; a partly grounded one loses
 * just the bad props.
 */
// A cue must name the thing shown; filler words would put the cut on nothing.
const FILLER_CUES = new Set([
  'a',
  'an',
  'the',
  'at',
  'in',
  'on',
  'of',
  'to',
  'and',
  'or',
  'it',
  'is',
  'for',
  'with',
  'by',
  'this',
  'that',
])

/** Re-labels StatSlam / BarRace numbers from the beat text; drops what cannot be labelled honestly. */
function groundShotLabels(props: Obj, show: string, text: string, ledger: Ledger): boolean {
  if (show === 'StatSlam' && typeof props.value === 'string') {
    const g = groundLabel(
      props.value,
      typeof props.label === 'string' ? props.label : '',
      text,
      ledger,
    )
    if (!g.label) return false
    props.label = g.label
  }
  if (show === 'BarRace' && Array.isArray(props.bars)) {
    const bars = props.bars
      .filter(isObj)
      .map((b) => ({
        value: String(b.value ?? ''),
        label: groundLabel(String(b.value ?? ''), String(b.label ?? ''), text, ledger).label,
      }))
      .filter((b) => b.label && b.value)
    if (bars.length < 2) return false
    props.bars = bars
  }
  return true
}

export type RepairContext = { sourceText?: string; claims?: readonly string[] }

/** "12 times" / "12x" -> "12×". */
export const displayValue = (raw: string): string =>
  raw
    .trim()
    .replace(/^(\S*\d)\s?(?:x|X|times)$/, '$1×')
    .replace(/\s+/g, ' ')

const sentenceWith = (text: string, cue: string): string => {
  const word = norm(cue.split('#')[0] ?? '')
  return (
    text.split(/(?<=[.!?])\s+/).find((s) => s.split(/\s+/).some((w) => norm(w) === word)) ?? text
  )
}

/**
 * Key point text must be a complete idea (text-rules `validKeyPoint`); an invalid one is replaced by
 * a short claim or a noun chunk of the cue's sentence, else the shot is dropped.
 */
function repairKeyPoint(props: Obj, text: string, cue: string, ctx: RepairContext): boolean {
  if (typeof props.text !== 'string' || props.quote) return true
  const fixed = keyPointText({
    given: props.text,
    claims: ctx.claims,
    text: sentenceWith(text, cue),
    context: text,
  })
  if (!fixed) return false
  props.text = fixed
  return true
}

/** A stat value is one real quantity; a number the beat says only as a name or version (RTX 5090, PyTorch 2.15) is not. */
function repairStatValue(props: Obj, text: string): boolean {
  if (typeof props.value !== 'string') return false
  const value = displayValue(props.value)
  if (!isQuantityValue(value)) return false
  const v = quantityValue(value)
  const digits = /\d[\d,]*(?:\.\d+)?/.exec(value)?.[0] ?? ''
  if (digits && text.includes(digits) && !findQuantities(text).some((q) => q.value === v))
    return false
  props.value = value
  return true
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Each code line is widened to the full source line that contains it; every line must then be complete. */
export function completeCodeLines(code: string, sourceText = ''): string | null {
  const source = sourceText
    .split('\n')
    .map(squash)
    .filter((l) => l.length <= 160)
  const lines = code
    .split('\n')
    .map(squash)
    .filter(Boolean)
    .map((l) => source.find((s) => s.length > l.length && s.includes(l)) ?? l)
  if (lines.length === 0 || !lines.every(isCompleteCodeLine)) return null
  return lines.join('\n')
}

export function repairShots(
  beat: Obj,
  facts: ReadonlySet<number>,
  ledger: Ledger = new Map(),
  ctx: RepairContext = {},
): void {
  if (!Array.isArray(beat.shots)) {
    delete beat.shots
    return
  }
  const text = typeof beat.text === 'string' ? beat.text : ''
  const kept: Obj[] = []
  for (const raw of beat.shots) {
    if (!isObj(raw) || typeof raw.show !== 'string') continue
    const cue = typeof raw.cue === 'string' ? raw.cue : raw.at
    if (typeof cue !== 'string' || FILLER_CUES.has(cue.trim().toLowerCase().split('#')[0] ?? ''))
      continue
    if (!SCREENS.has(raw.show) || !cueExists(cue, text)) continue
    const shot: Obj = { at: cue.trim(), show: raw.show }
    if (typeof raw.sfx === 'string' && SFX.has(raw.sfx)) shot.sfx = raw.sfx
    if (isObj(raw.props)) {
      const props: Obj = {}
      let dropped = 0
      for (const [key, value] of Object.entries(raw.props)) {
        if (typeof value === 'boolean' || value === null || value === undefined) continue
        if (PAPER_REF_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number')) {
          props[key] = value
          continue
        }
        if (propIsGrounded(value, facts)) props[key] = value
        else dropped++
      }
      if (dropped > 0 && Object.keys(props).length === 0) continue
      if (raw.show === 'StatSlam' && !('value' in props)) continue
      if (raw.show === 'StatSlam' && !repairStatValue(props, text)) continue
      if (raw.show === 'KeyPoint' && !repairKeyPoint(props, text, cue, ctx)) continue
      if (raw.show === 'CodeBlock' && typeof props.code === 'string') {
        const code = completeCodeLines(props.code, ctx.sourceText)
        if (!code) continue
        props.code = code
      }
      if (raw.show === 'Terminal' && Array.isArray(props.lines)) {
        const lines = props.lines.filter((l): l is string => typeof l === 'string')
        if (lines.length > 0 && !lines.every((l) => completeCodeLines(l, ctx.sourceText))) continue
      }
      if (!groundShotLabels(props, raw.show, text, ledger)) continue
      if (Object.keys(props).length > 0) shot.props = props
    }
    kept.push(shot)
    if (kept.length >= MAX_SHOTS_PER_BEAT) break
  }
  if (kept.length > 0) beat.shots = kept
  else delete beat.shots
}

/** Stock-footage search terms: at most 2 short lowercase phrases per beat; anything else is dropped. */
export function repairBroll(beat: Obj): void {
  if (!Array.isArray(beat.broll)) {
    delete beat.broll
    return
  }
  const terms = beat.broll
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 40 && t === t.toLowerCase() && /^[a-z ]+$/.test(t))
    .slice(0, 2)
  if (terms.length > 0) beat.broll = terms
  else delete beat.broll
}

export function narrationWordCount(script: {
  hook: string
  beats: readonly { text: string }[]
  outro: string
}): number {
  return [script.hook, ...script.beats.map((b) => b.text), script.outro]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
}
