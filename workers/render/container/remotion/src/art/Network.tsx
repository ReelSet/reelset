import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR } from '../theme'
import { ArtStage, clamp, draw, ink, lerp, lime, pop, type ArtProps } from './kit'

type Node = { x: number; y: number }

export function Network({ w, h, seed }: ArtProps) {
  const frame = useCurrentFrame()
  const r = rng(seed)
  const sizes = [3, 4 + Math.floor(r() * 2), 4 + Math.floor(r() * 2), 3]
  const layers = sizes.length
  const padX = 62
  const padY = 38
  const maxN = Math.max(...sizes)
  const gap = Math.min(74, (h - 2 * padY) / (maxN - 1))
  const grid: Node[][] = sizes.map((n, l) =>
    Array.from({ length: n }, (_, i) => ({
      x: padX + (l * (w - 2 * padX)) / (layers - 1),
      y: h / 2 + (i - (n - 1) / 2) * gap + (r() - 0.5) * 6,
    })),
  )
  const edges: { a: Node; b: Node; l: number; wt: number }[] = []
  for (let l = 0; l < layers - 1; l++) {
    for (const a of grid[l] ?? []) {
      for (const b of grid[l + 1] ?? []) {
        const wt = r()
        if (wt > 0.28) edges.push({ a, b, l, wt })
      }
    }
  }
  const pulse = ((frame - 16) / 24) % (layers + 1.4)
  const lit = (pos: number) => clamp(1 - Math.abs(pos - pulse) * 0.9)
  return (
    <ArtStage w={w} h={h}>
      {edges.map((e, i) => {
        const p = clamp((frame - 4 - e.l * 7 - (i % 3) * 2) / 18)
        const glow = lit(e.l + 0.5) * e.wt
        return (
          <g key={i}>
            <line
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              stroke={ink(0.13)}
              strokeWidth={1.4}
              {...draw(p)}
            />
            <line
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              stroke={COLOR.accent}
              strokeWidth={2.2}
              strokeLinecap="round"
              opacity={glow * 0.85 * clamp(p * 4)}
            />
          </g>
        )
      })}
      {grid.map((col, l) =>
        col.map((n, i) => {
          const s = pop(frame, 2 + l * 6 + i * 2)
          const glow = lit(l)
          const last = l === layers - 1
          const radius = (last ? 15 : 11) * s + glow * 3
          return (
            <g key={`${l}-${i}`}>
              {glow > 0.05 ? (
                <circle cx={n.x} cy={n.y} r={radius + 9} fill={lime(0.16 * glow)} />
              ) : null}
              <circle
                cx={n.x}
                cy={n.y}
                r={Math.max(0, radius)}
                fill={glow > 0.05 ? lime(lerp(0.12, 1, glow)) : '#17171b'}
                stroke={glow > 0.05 ? COLOR.accent : ink(last ? 0.5 : 0.28)}
                strokeWidth={1.8}
              />
            </g>
          )
        }),
      )}
    </ArtStage>
  )
}
