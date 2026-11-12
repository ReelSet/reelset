import { groundLabel, mentions, valueOf, type Ledger } from './labels'
import { corpusOf } from './numbers'
import { findQuantities, isQuantityValue } from './text-rules'
import type { ReelProps, ScreenName, TimedShot } from './types'

type Bar = { label?: unknown; value?: unknown }

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''

/** "12 times" / "12x" -> "12×"; anything else trimmed. */
export function displayValue(raw: string): string {
  return raw
    .trim()
    .replace(/^(\S*\d)\s?(?:x|X|times)$/, '$1×')
    .replace(/\s+/g, ' ')
}

/** A shot with nothing honest left to say; the key point pass words it from the narration. */
const toKeyPoint = (shot: TimedShot): TimedShot => ({
  ...shot,
  show: 'KeyPoint' as ScreenName,
  props: { text: '', sub: '' },
  origin: 'planned',
})

const SIZE_UNIT = /\d\s?(?:[bBmMkK]|billion|million)$/
const SIZE_NOUN = /\b(?:models?|parameters?|params|weights|checkpoints?|llms?)\b/i
const INPUT_NOUN =
  /(?<![\w-])(?:pictures?|photos?|images?|samples?|examples?|epochs?|seeds?|layers?|heads?|prompts?|questions?)(?![\w-])/i

/**
 * A number that says how big the thing is or how much went in is not a result: "1.7B" (a model
 * size, said as "1.7B and 4B models"), "94 pictures" (the training set), "-261.18" (a unitless table
 * cell). A big stat shows an outcome a viewer can read, so these stay in the narration and the captions.
 */
export function isSetupNumber(value: string, label: string, text: string): boolean {
  const v = valueOf(value)
  if (INPUT_NOUN.test(label)) return true
  // A bare table cell ("-261.18", "94.70") has no unit a viewer can read, and its sign is easy to lose.
  if (/^[−-]?\d+\.\d{2,}$/.test(value.trim())) return true
  if (v === null) return false
  if (!SIZE_UNIT.test(value.trim()) || /%|×/.test(value)) return false
  if (SIZE_NOUN.test(label)) return true
  return mentions(text).some((m) => {
    if (m.value !== v) return false
    const after = text
      .slice(m.end, m.end + 40)
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')
    return SIZE_NOUN.test(after.replace(/[.;:!?].*$/, ''))
  })
}

/** Numbers a label says were the other side of its comparison ("... · was 80.9%"). */
function labelPartner(label: string): number | null {
  const m = / · (?:was|from) (\S+)/.exec(label)
  return m?.[1] ? valueOf(m[1]) : null
}

/** The value is said somewhere as a real quantity (not "RTX 5090", "PyTorch 2.15" or a date). */
export function isQuotedQuantity(value: number, texts: readonly string[]): boolean {
  return texts.some((t) =>
    findQuantities(t).some((q) => q.value === value || valueOf(q.raw) === value),
  )
}

/**
 * Every StatSlam / BarRace number must be a real quantity said in the narration, claims or item
 * facts, shown at most once per reel, with a label taken from what that text says the number is.
 * A label reused for another number is rewritten or dropped. A shot left with nothing honest to
 * say becomes a key point.
 */
export function groundShots(shots: TimedShot[], props: ReelProps): TimedShot[] {
  const ledger: Ledger = new Map()
  const shown = new Set<number>()
  const corpus = corpusOf(props)
  const headlineValues = mentions(props.headline ?? '').map((m) => m.value)
  return shots.map((shot, index) => {
    const scene = props.scenes[shot.sceneIndex]
    const text = scene && 'text' in scene ? scene.text : ''
    if (shot.show === 'StatSlam') {
      const value = displayValue(str(shot.props.value))
      const v = valueOf(value)
      if (!value || v === null || !isQuantityValue(value) || shown.has(v)) return toKeyPoint(shot)
      if (index > 1 && headlineValues.includes(v)) return toKeyPoint(shot)
      if (!isQuotedQuantity(v, [text, ...corpus])) return toKeyPoint(shot)
      const g = groundLabel(value, str(shot.props.label), text, ledger, corpus)
      if (!g.label || isSetupNumber(value, g.label, text)) return toKeyPoint(shot)
      shown.add(v)
      const partner = labelPartner(g.label)
      if (partner !== null) shown.add(partner)
      return { ...shot, props: { ...shot.props, value, label: g.label } }
    }
    if (shot.show === 'BarRace' && Array.isArray(shot.props.bars) && str(shot.props.title)) {
      const said = (b: Bar) =>
        /^(?:before|now)$/i.test(str(b.label)) ||
        text.toLowerCase().includes(str(b.label).toLowerCase())
      const bars = (shot.props.bars as Bar[]).map((b) => ({
        label: str(b.label),
        value: displayValue(str(b.value)),
      }))
      const honest = bars.every((b) => {
        const v = valueOf(b.value)
        const quoted =
          v !== null &&
          (isQuotedQuantity(v, [text, ...corpus]) || mentions(text).some((m) => m.value === v))
        return quoted && isQuantityValue(b.value) && said(b)
      })
      const fresh = bars.every((b) => !shown.has(valueOf(b.value)!) || shot.props.times)
      if (bars.length < 2 || !honest || !fresh) return toKeyPoint(shot)
      for (const b of bars) shown.add(valueOf(b.value)!)
      return { ...shot, props: { ...shot.props, bars } }
    }
    if (shot.show === 'BarRace' && Array.isArray(shot.props.bars)) {
      const bars = (shot.props.bars as Bar[])
        .map((b) => {
          const value = displayValue(str(b.value))
          const v = valueOf(value)
          if (v === null || !isQuantityValue(value) || !isQuotedQuantity(v, [text, ...corpus]))
            return null
          const g = groundLabel(value, str(b.label), text, ledger, corpus)
          return g.label ? { label: g.label, value } : null
        })
        .filter((b): b is { label: string; value: string } => b !== null)
      if (bars.length < 2 || bars.some((b) => shown.has(valueOf(b.value)!))) return toKeyPoint(shot)
      for (const b of bars) shown.add(valueOf(b.value)!)
      return { ...shot, props: { ...shot.props, bars } }
    }
    return shot
  })
}
