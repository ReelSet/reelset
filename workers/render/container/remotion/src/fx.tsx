import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { TRANSITION_FRAMES, type TransitionName } from './lib/transitions'

export function useSpring(delay = 0, damping = 14, mass = 0.6): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: { damping, mass, stiffness: 140 } })
}

export function useProgress(frames: number, from = 0): number {
  const frame = useCurrentFrame()
  return interpolate(frame, [from, Math.max(from + 1, frames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

export const easeOut = (p: number) => 1 - (1 - p) ** 3
export const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const cubic = (t: number) => 1 - (1 - t) ** 3
const ramp = (frame: number, frames: number) =>
  interpolate(frame, [0, frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cubic })

/** How a shot arrives. Moving kinds slide over the previous shot, which the Reel keeps underneath. */
export function Transition({ kind, children }: { kind: TransitionName | null; children: ReactNode }) {
  const frame = useCurrentFrame()
  let style: CSSProperties = {}
  let flash = 0
  if (kind === 'punch') {
    style = { transform: `scale(${1 + 0.1 * (1 - ramp(frame, 6))})` }
    flash = interpolate(frame, [0, 4], [0.16, 0], { extrapolateRight: 'clamp' })
  } else if (kind === 'cut') {
    style = { transform: `scale(${1 + 0.03 * (1 - ramp(frame, 5))})` }
  } else if (kind === 'slide') {
    const p = ramp(frame, TRANSITION_FRAMES.slide)
    style = { transform: `translateX(${(1 - p) * 1080}px)`, boxShadow: p < 1 ? '-30px 0 60px rgba(0,0,0,0.45)' : undefined }
  } else if (kind === 'whip') {
    const p = ramp(frame, TRANSITION_FRAMES.whip)
    style = {
      transform: `translateX(${(1 - p) * 640}px) scale(${1 + 0.06 * (1 - p)})`,
      filter: p < 1 ? `blur(${(1 - p) * 22}px)` : undefined,
      opacity: Math.min(1, 0.35 + p * 1.4),
    }
  } else if (kind === 'rise') {
    const p = ramp(frame, TRANSITION_FRAMES.rise)
    style = { transform: `translateY(${(1 - p) * 220}px)`, opacity: Math.min(1, p * 2) }
  }
  return (
    <AbsoluteFill style={style}>
      {children}
      {flash > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: flash, pointerEvents: 'none' }} /> : null}
    </AbsoluteFill>
  )
}

/** Slow push-in so a held screen never sits still. */
export function Drift({ children, frames, to = 1.05 }: { children: ReactNode; frames: number; to?: number }) {
  const scale = interpolate(useCurrentFrame(), [0, Math.max(1, frames)], [1, to], {
    extrapolateRight: 'clamp',
  })
  return <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>
}

/** Spring scale-up for a card or row arriving. */
export function Pop({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode
  delay?: number
  style?: CSSProperties
}) {
  const s = useSpring(delay, 11)
  return (
    <div
      style={{
        opacity: s > 0.02 ? 1 : 0,
        transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`,
        transformOrigin: '50% 50%',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Rise({
  children,
  delay = 0,
  distance = 40,
  style,
}: {
  children: ReactNode
  delay?: number
  distance?: number
  style?: CSSProperties
}) {
  const s = useSpring(delay, 16, 0.7)
  return (
    <div
      style={{
        opacity: Math.min(1, s * 1.6),
        transform: `translateY(${interpolate(s, [0, 1], [distance, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
