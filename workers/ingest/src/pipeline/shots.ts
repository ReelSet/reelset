import { SCREEN_NAMES, SFX_NAMES } from '@reelset/core'
import { groundLabel, type Ledger } from './stat-labels'

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

export function repairShots(
  beat: Obj,
  facts: ReadonlySet<number>,
  ledger: Ledger = new Map(),
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
