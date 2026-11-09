import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR, MONO } from '../theme'
import { ArtStage, ease, clamp, ink, lerp, pop, type ArtProps } from './kit'

const LABELS = ['v1', 'v2', 'v3', 'latest']

export function Bars({ w, h, seed }: ArtProps) {
  const frame = useCurrentFrame()
  const r = rng(seed)
  const n = h >= 300 ? 4 : 3
  const labels = n === 4 ? LABELS : ['v1', 'v2', 'latest']
  const base = 0.2 + r() * 0.12
  const vals = labels.map((_, i) =>
    i === n - 1 ? 1 : lerp(base, 0.78, i / (n - 1)) + (r() - 0.5) * 0.06,
  )
  const padX = 40
  const labelW = 78
  const valW = 72
  const trackX = padX + labelW
  const trackW = w - trackX - padX - valW
  const rowH = Math.min(66, (h - 70) / n)
  const top = (h - rowH * n) / 2
  const gridXs = [0, 0.25, 0.5, 0.75, 1].map((p) => trackX + p * trackW)
  return (
    <ArtStage w={w} h={h}>
      {gridXs.map((x, i) => (
        <line
          key={i}
          x1={x}
          y1={top - 10}
          x2={x}
          y2={top + rowH * n}
          stroke={ink(0.07)}
          strokeDasharray="3 6"
        />
      ))}
      {vals.map((v, i) => {
        const p = ease((frame - 6 - i * 8) / 26)
        const last = i === n - 1
        const y = top + i * rowH
        const bh = Math.min(26, rowH * 0.5)
        const ratio = (v / (vals[0] ?? 1)) * p
        const fade = clamp((frame - 4 - i * 8) / 8)
        return (
          <g key={i} opacity={fade}>
            <text
              x={padX}
              y={y + rowH / 2 + 5}
              fontFamily={MONO}
              fontSize={15}
              fill={last ? ink(0.9) : ink(0.4)}
            >
              {labels[i]}
            </text>
            <rect
              x={trackX}
              y={y + (rowH - bh) / 2}
              width={trackW}
              height={bh}
              rx={bh / 2}
              fill={ink(0.05)}
            />
            <rect
              x={trackX}
              y={y + (rowH - bh) / 2}
              width={Math.max(0, trackW * v * p)}
              height={bh}
              rx={bh / 2}
              fill={last ? COLOR.accent : ink(0.2)}
            />
            <text
              x={w - padX}
              y={y + rowH / 2 + 8}
              textAnchor="end"
              fontFamily={MONO}
              fontSize={last ? 26 : 20}
              fontWeight={700}
              fill={last ? COLOR.accent : ink(0.5)}
            >
              {ratio.toFixed(1)}x
            </text>
          </g>
        )
      })}
    </ArtStage>
  )
}
