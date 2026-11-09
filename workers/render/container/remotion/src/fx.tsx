import type { CSSProperties, ReactNode } from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { OVERLAP } from './theme'

export function useSpring(delay = 0, damping = 16, mass = 0.7): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: { damping, mass, stiffness: 120 } })
}

export function useProgress(frames: number, from = 0): number {
  const frame = useCurrentFrame()
  return interpolate(frame, [from, Math.max(from + 1, frames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

export const easeOut = (p: number) => 1 - (1 - p) ** 3

// Scene enter (spring rise) and exit (fade across the overlap window, under the next scene's enter).
export function SceneFrame({ frames, children }: { frames: number; children: ReactNode }) {
  const frame = useCurrentFrame()
  const enter = useSpring(0, 18, 0.8)
  const out = interpolate(frame, [frames - OVERLAP, frames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    opacity: Math.min(1, enter * 1.4) * out,
    transform: `translateY(${interpolate(enter, [0, 1], [34, 0])}px) scale(${interpolate(enter, [0, 1], [0.985, 1])})`,
  }
  return <div style={style}>{children}</div>
}

export function Rise({
  children,
  delay = 0,
  distance = 22,
  style,
}: {
  children: ReactNode
  delay?: number
  distance?: number
  style?: CSSProperties
}) {
  const s = useSpring(delay, 18, 0.7)
  return (
    <div
      style={{
        opacity: Math.min(1, s * 1.5),
        transform: `translateY(${interpolate(s, [0, 1], [distance, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function KenBurns({
  frames,
  children,
  from = 1.03,
  to = 1.1,
  pan = 10,
}: {
  frames: number
  children: ReactNode
  from?: number
  to?: number
  pan?: number
}) {
  const p = useProgress(frames)
  const scale = from + (to - from) * p
  const x = (p - 0.5) * -pan
  return (
    <div
      style={{ position: 'absolute', inset: 0, transform: `translateX(${x}px) scale(${scale})` }}
    >
      {children}
    </div>
  )
}
