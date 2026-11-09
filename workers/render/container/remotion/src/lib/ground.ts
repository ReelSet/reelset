import { salientPhrase } from './extract'
import { groundLabel, type Ledger } from './labels'
import type { ReelProps, ScreenName, TimedShot } from './types'

type Bar = { label?: unknown; value?: unknown }

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''

function keyPoint(shot: TimedShot, text: string): TimedShot {
  return { ...shot, show: 'KeyPoint' as ScreenName, props: { text: salientPhrase(text), sub: '' } }
}

/**
 * Every StatSlam / BarRace label must come from the narration next to its number; a label reused for
 * another number is rewritten from context or dropped. A shot left with nothing honest to say
 * becomes a plain KeyPoint.
 */
export function groundShots(shots: TimedShot[], props: ReelProps): TimedShot[] {
  const ledger: Ledger = new Map()
  return shots.map((shot) => {
    const scene = props.scenes[shot.sceneIndex]
    const text = scene && 'text' in scene ? scene.text : ''
    if (shot.show === 'StatSlam') {
      const value = str(shot.props.value)
      if (!value) return shot
      const g = groundLabel(value, str(shot.props.label), text, ledger)
      if (!g.label) return keyPoint(shot, text)
      return { ...shot, props: { ...shot.props, label: g.label } }
    }
    if (shot.show === 'BarRace' && Array.isArray(shot.props.bars)) {
      const bars = (shot.props.bars as Bar[])
        .map((b) => {
          const g = groundLabel(str(b.value), str(b.label), text, ledger)
          return g.label ? { label: g.label, value: str(b.value) } : null
        })
        .filter((b): b is { label: string; value: string } => b !== null)
      if (bars.length < 2) return keyPoint(shot, text)
      return { ...shot, props: { ...shot.props, bars } }
    }
    return shot
  })
}
