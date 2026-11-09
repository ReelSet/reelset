import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR, MONO } from '../theme'
import { ArtStage, clamp, ink, lerp, lime, pop, type ArtProps } from './kit'

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function Timeline({ w, h, frames, seed }: ArtProps) {
  const frame = useCurrentFrame()
  const r = rng(seed)
  const pad = 32
  const tall = h >= 300
  const sh = h * (tall ? 0.5 : 0.52)
  const sw = Math.min(w - 2 * pad, sh * 1.78)
  const sx = (w - sw) / 2
  const sy = pad - 6
  const total = 360 + Math.floor(r() * 900)
  const prog = clamp(0.12 + (frame / Math.max(60, frames)) * 0.7)
  const trackX = pad
  const trackW = w - 2 * pad
  const scrubY = sy + sh + 24
  const clipY = scrubY + 20
  const clipH = tall ? 34 : 28
  const clips: { x: number; w: number }[] = []
  let cx = 0
  while (cx < 0.97) {
    const cw = 0.1 + r() * 0.16
    clips.push({ x: cx, w: Math.min(cw, 0.99 - cx) })
    cx += cw + 0.012
  }
  const bars = Array.from({ length: 56 }, () => 0.25 + r() * 0.75)
  const waveY = clipY + clipH + 14
  const playX = trackX + trackW * prog
  const s = pop(frame, 2, 18)
  const btn = pop(frame, 12)
  return (
    <ArtStage w={w} h={h}>
      <g opacity={clamp(s * 1.4)} transform={`translate(0 ${(1 - s) * 16})`}>
        <rect x={sx} y={sy} width={sw} height={sh} rx={14} fill="#0b0b0e" stroke={ink(0.14)} />
        <rect x={sx} y={sy} width={sw} height={sh} rx={14} fill={`url(#screenGlow)`} />
        <defs>
          <radialGradient id="screenGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={COLOR.accent} stopOpacity={0.16} />
            <stop offset="100%" stopColor={COLOR.accent} stopOpacity={0} />
          </radialGradient>
        </defs>
        <g transform={`translate(${sx + sw / 2} ${sy + sh / 2}) scale(${btn})`}>
          <circle r={30} fill={COLOR.accent} />
          <path d="M -8 -13 L 14 0 L -8 13 Z" fill={COLOR.accentInk} />
        </g>
        <text x={sx + 16} y={sy + sh - 14} fontFamily={MONO} fontSize={13} fill={ink(0.5)}>
          {mmss(total * prog)} / {mmss(total)}
        </text>
      </g>
      <g opacity={clamp((frame - 8) / 10)}>
        <rect x={trackX} y={scrubY - 2} width={trackW} height={4} rx={2} fill={ink(0.12)} />
        <rect
          x={trackX}
          y={scrubY - 2}
          width={trackW * prog}
          height={4}
          rx={2}
          fill={COLOR.accent}
        />
        {clips.map((c, i) => {
          const p = pop(frame, 10 + i * 3)
          const hot = trackX + trackW * (c.x + c.w) > playX && trackX + trackW * c.x <= playX
          return (
            <rect
              key={i}
              x={trackX + trackW * c.x}
              y={clipY + (1 - p) * 8}
              width={trackW * c.w}
              height={clipH}
              rx={6}
              fill={hot ? lime(0.28) : ink(0.07)}
              stroke={hot ? lime(0.8) : ink(0.14)}
              opacity={clamp(p)}
            />
          )
        })}
        {tall
          ? bars.map((b, i) => {
              const x = trackX + (i / bars.length) * trackW
              const passed = x < playX
              const bh = lerp(4, 22, b)
              return (
                <rect
                  key={i}
                  x={x}
                  y={waveY + (22 - bh) / 2}
                  width={4}
                  height={bh}
                  rx={2}
                  fill={passed ? lime(0.8) : ink(0.14)}
                />
              )
            })
          : null}
        <line
          x1={playX}
          y1={scrubY - 12}
          x2={playX}
          y2={tall ? waveY + 26 : clipY + clipH + 8}
          stroke={COLOR.accent}
          strokeWidth={2}
        />
        <circle cx={playX} cy={scrubY} r={7} fill={COLOR.accent} />
      </g>
    </ArtStage>
  )
}
