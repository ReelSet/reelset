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
  return shots.map((shot) => {
    const scene = props.scenes[shot.sceneIndex]
    const text = scene && 'text' in scene ? scene.text : ''
    if (shot.show === 'StatSlam') {
      const value = displayValue(str(shot.props.value))
      const v = valueOf(value)
      if (!value || v === null || !isQuantityValue(value) || shown.has(v)) return toKeyPoint(shot)
      if (!isQuotedQuantity(v, [text, ...corpus])) return toKeyPoint(shot)
      const g = groundLabel(value, str(shot.props.label), text, ledger, corpus)
      if (!g.label) return toKeyPoint(shot)
      shown.add(v)
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
