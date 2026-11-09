import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR, MONO } from '../theme'
import { ArtStage, clamp, draw, ink, lime, pop, type ArtProps } from './kit'

const hash = (r: () => number) =>
  Array.from({ length: 7 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('')

export function GitGraph({ w, h, seed }: ArtProps) {
  const frame = useCurrentFrame()
  const r = rng(seed)
  const flip = r() > 0.5 ? 1 : -1
  const pad = 46
  const ym = h / 2
  const lane = Math.min(92, h * 0.3)
  const xs = Array.from({ length: 6 }, (_, i) => pad + (i * (w - 2 * pad - 30)) / 5)
  const ya = ym - flip * lane
  const yb = ym + flip * lane
  const branch = (from: number, to: number, y: number, n: number) => {
    const x0 = xs[from] ?? 0
    const x1 = xs[to] ?? 0
    const pts = Array.from({ length: n }, (_, i) => x0 + 46 + ((i + 0.5) * (x1 - x0 - 92)) / n)
    const d = `M ${x0} ${ym} C ${x0 + 28} ${ym} ${x0 + 18} ${y} ${x0 + 46} ${y} L ${x1 - 46} ${y} C ${x1 - 18} ${y} ${x1 - 28} ${ym} ${x1} ${ym}`
    return { d, pts, y }
  }
  const a = branch(1, 4, ya, 2)
  const b = branch(2, 5, yb, 2)
  const mainP = clamp((frame - 2) / 40)
  const bp = (start: number) => clamp((frame - start) / 34)
  const lastAt = 62
  const ringP = clamp((frame - lastAt) / 24)
  const commits: { x: number; y: number; at: number; main: boolean }[] = [
    ...xs.map((x, i) => ({ x, y: ym, at: 4 + i * 6, main: true })),
    ...a.pts.map((x, i) => ({ x, y: a.y, at: 24 + i * 9, main: false })),
    ...b.pts.map((x, i) => ({ x, y: b.y, at: 34 + i * 9, main: false })),
  ]
  return (
    <ArtStage w={w} h={h}>
      <line
        x1={xs[0]}
        y1={ym}
        x2={xs[5]}
        y2={ym}
        stroke={ink(0.22)}
        strokeWidth={3}
        strokeLinecap="round"
        {...draw(mainP)}
      />
      <path
        d={a.d}
        fill="none"
        stroke={ink(0.3)}
        strokeWidth={3}
        strokeLinecap="round"
        {...draw(bp(16))}
      />
      <path
        d={b.d}
        fill="none"
        stroke={lime(0.75)}
        strokeWidth={3}
        strokeLinecap="round"
        {...draw(bp(26))}
      />
      {commits.map((c, i) => {
        const s = pop(frame, c.at)
        const isLast = c.main && c.x === xs[5]
        return (
          <g key={i}>
            <circle
              cx={c.x}
              cy={c.y}
              r={Math.max(0, (isLast ? 11 : 8) * s)}
              fill={isLast ? COLOR.accent : '#15151a'}
              stroke={isLast ? COLOR.accent : ink(0.55)}
              strokeWidth={2.2}
            />
          </g>
        )
      })}
      {ringP > 0 ? (
        <circle
          cx={xs[5]}
          cy={ym}
          r={11 + ringP * 22}
          fill="none"
          stroke={COLOR.accent}
          strokeWidth={2}
          opacity={(1 - ringP) * 0.8}
        />
      ) : null}
      {xs.slice(0, 5).map((x, i) => (
        <text
          key={i}
          x={x}
          y={ym + 28}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={11}
          fill={ink(0.32 * clamp((frame - 10 - i * 6) / 8))}
        >
          {hash(r)}
        </text>
      ))}
      <g
        opacity={clamp((frame - lastAt) / 10)}
        transform={`translate(${(xs[5] ?? 0) - 30} ${ym - 46 + (1 - pop(frame, lastAt)) * 8})`}
      >
        <rect width={60} height={24} rx={12} fill={COLOR.accent} />
        <text
          x={30}
          y={16.5}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={12}
          fontWeight={700}
          fill={COLOR.accentInk}
        >
          main
        </text>
      </g>
    </ArtStage>
  )
}
