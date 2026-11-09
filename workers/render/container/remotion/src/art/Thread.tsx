import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR, MONO } from '../theme'
import { ArtStage, clamp, draw, ease, ink, lime, pop, type ArtProps } from './kit'

const TONES = ['#3a3a42', '#46464f', '#2f2f36', '#52525c']

export function Thread({ w, h, seed }: ArtProps) {
  const frame = useCurrentFrame()
  const r = rng(seed)
  const pad = 30
  const n = h >= 360 ? 4 : h >= 260 ? 3 : 2
  const plan = [
    { depth: 0, lines: 2 },
    { depth: 1, lines: 2 },
    { depth: 0, lines: 1 },
    { depth: 1, lines: 2 },
  ].slice(0, n)
  const slot = (h - 2 * pad + 14) / n
  const bh = Math.min(76, slot - 14)
  const votes = 240 + Math.floor(r() * 2400)
  const indent = 34
  return (
    <ArtStage w={w} h={h}>
      {plan.map((c, i) => {
        const s = pop(frame, 4 + i * 12)
        const x = pad + c.depth * indent
        const y = pad - 6 + i * slot
        const bw = w - x - pad - 8
        const op = plan[0] && i === 0
        const shown = Math.round(votes * ease((frame - 14) / 36))
        return (
          <g key={i} opacity={clamp(s * 1.5)} transform={`translate(${(1 - s) * -22} 0)`}>
            {c.depth === 1 ? (
              <path
                d={`M ${x - 18} ${y - slot + bh} L ${x - 18} ${y + 22} L ${x - 4} ${y + 22}`}
                fill="none"
                stroke={ink(0.16)}
                strokeWidth={1.6}
                strokeLinecap="round"
                {...draw(clamp((frame - 8 - i * 12) / 14))}
              />
            ) : null}
            <circle
              cx={x + 14}
              cy={y + 14}
              r={14}
              fill={op ? COLOR.accent : TONES[i % TONES.length]}
            />
            <rect
              x={x + 38}
              y={y + 7}
              width={52 + ((i * 23) % 40)}
              height={6}
              rx={3}
              fill={ink(op ? 0.7 : 0.4)}
            />
            <rect x={x + 38} y={y + 20} width={30} height={4} rx={2} fill={ink(0.16)} />
            <rect
              x={x + 38}
              y={y + 32}
              width={bw - 38}
              height={bh - 32}
              rx={12}
              fill={ink(0.045)}
              stroke={op ? lime(0.5) : ink(0.1)}
            />
            {Array.from({ length: c.lines }, (_, k) => (
              <rect
                key={k}
                x={x + 52}
                y={y + 44 + k * 13}
                width={(bw - 78) * (k === c.lines - 1 && c.lines > 1 ? 0.55 : 0.92)}
                height={4.5}
                rx={2.2}
                fill={ink(0.26)}
              />
            ))}
            {op ? (
              <g transform={`translate(${w - pad - 62} ${y + 4})`}>
                <path d="M 8 3 L 15 13 L 1 13 Z" fill={COLOR.accent} />
                <text
                  x={22}
                  y={13}
                  fontFamily={MONO}
                  fontSize={14}
                  fontWeight={700}
                  fill={COLOR.accent}
                >
                  {shown}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
    </ArtStage>
  )
}
