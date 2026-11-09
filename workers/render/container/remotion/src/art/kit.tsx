import type { ReactNode } from 'react'
import { spring } from 'remotion'
import { COLOR, FPS } from '../theme'

export type ArtProps = { w: number; h: number; frames: number; seed: number; tool: string }

export const ink = (a: number) => `rgba(244,244,245,${a})`
export const lime = (a: number) => `rgba(200,247,81,${a})`

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
export const ease = (p: number) => 1 - (1 - clamp(p)) ** 3
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p

export function pop(frame: number, delay: number, damping = 15): number {
  return spring({
    frame: frame - delay,
    fps: FPS,
    config: { damping, mass: 0.7, stiffness: 130 },
  })
}

// Progressive stroke reveal for any SVG path/line (normalised via pathLength).
export function draw(p: number) {
  const v = clamp(p)
  return { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - v, opacity: clamp(v * 10) }
}

export function ArtStage({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(90% 80% at 85% 0%, rgba(200,247,81,0.13), rgba(200,247,81,0) 60%), radial-gradient(70% 70% at 5% 100%, rgba(120,140,255,0.10), rgba(120,140,255,0) 65%), #101013',
      }}
    >
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill={ink(0.07)} />
          </pattern>
        </defs>
        <rect width={w} height={h} fill="url(#dots)" />
        {children}
      </svg>
    </div>
  )
}

export const PAGE = COLOR.surface2
