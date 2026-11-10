import { MIN_FILL, fillShare } from './fill'
import type { TimedShot } from './types'

/** The item's source plate (chip, title, big count) is a card of its own look: it shows this often per reel. */
export const MAX_PLATES = 2

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** A key point that renders over the context plate (no footage behind it, not a quote, list or hook). */
export const isPlated = (s: Pick<TimedShot, 'show' | 'props'>): boolean =>
  s.show === 'KeyPoint' &&
  s.props.hook !== true &&
  !s.props.quote &&
  !Array.isArray(s.props.items) &&
  typeof s.props.bg !== 'number'

/**
 * The same source card four times in one reel reads as a loop, and the big count said once already
 * (the hook, or the first plate) is not said again. The first `MAX_PLATES` plates keep the card;
 * later text cards go bare (the statement set as large as the room allows) when that still fills
 * the frame (`bare: true`), and only the first plate shows the count (`noCount: true` after it).
 */
export function limitPlates(
  shots: TimedShot[],
  topPadFor: (s: TimedShot) => number = () => 0,
): TimedShot[] {
  let plates = 0
  let counted = shots[0]?.props.proof === true
  return shots.map((s) => {
    if (!isPlated(s)) return s
    plates += 1
    const text = str(s.props.text)
    if (plates > MAX_PLATES && text) {
      const bare = { ...s, props: { ...s.props, bare: true } }
      if (fillShare(bare, topPadFor(s)) >= MIN_FILL) return bare
    }
    const showCount = !counted
    counted = true
    return showCount ? s : { ...s, props: { ...s.props, noCount: true } }
  })
}

/** The end card is a static card: it holds this long at most, the rest goes to the shot before it. */
export const END_CARD_MAX_S = 3

/** Hands the end card's time over its cap to the shot before it, which may grow to `maxHold` seconds. */
export function capEndCard(shots: TimedShot[], fps: number, maxHold = 4): TimedShot[] {
  const last = shots[shots.length - 1]
  const prev = shots[shots.length - 2]
  if (!last || last.show !== 'EndCard' || !prev || prev.show === 'EndCard') return shots
  const extra = last.frames - Math.round(END_CARD_MAX_S * fps)
  const room = Math.round(maxHold * fps) - prev.frames
  const give = Math.min(extra, room)
  if (give <= 0) return shots
  return [
    ...shots.slice(0, -2),
    { ...prev, frames: prev.frames + give },
    { ...last, from: last.from + give, frames: last.frames - give },
  ]
}
