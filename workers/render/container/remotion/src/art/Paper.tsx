import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR } from '../theme'
import { ArtStage, PAGE, clamp, draw, ink, lime, pop, type ArtProps } from './kit'

export function Paper({ w, h, seed }: ArtProps) {
  const frame = useCurrentFrame()
  const r = rng(seed)
  const padY = 22
  const ph = h - 2 * padY
  const pw = Math.min(ph * 0.74, w * 0.5)
  const px = 40
  const m = 20
  const rise = pop(frame, 0, 18)
  const textTop = padY + 66
  const lineGap = 11
  const count = Math.floor((ph - 66 - 20) / lineGap)
  const widths = Array.from({ length: count }, () => 0.55 + r() * 0.45)
  const marks = [Math.floor(count * 0.18), Math.floor(count * 0.48), Math.floor(count * 0.76)].map(
    (v, i) => Math.max(1, v + i),
  )
  const noteX = px + pw + 34
  const noteW = w - noteX - 40
  return (
    <ArtStage w={w} h={h}>
      <g transform={`translate(0 ${(1 - rise) * 24})`} opacity={clamp(rise * 1.4)}>
        <rect
          x={px + 9}
          y={padY + 9}
          width={pw}
          height={ph}
          rx={8}
          fill={ink(0.04)}
          stroke={ink(0.07)}
        />
        <rect x={px} y={padY} width={pw} height={ph} rx={8} fill={PAGE} stroke={ink(0.14)} />
        <rect x={px + m} y={padY + 22} width={pw * 0.78} height={8} rx={4} fill={ink(0.8)} />
        <rect x={px + m} y={padY + 38} width={pw * 0.5} height={8} rx={4} fill={ink(0.8)} />
        <rect x={px + m} y={padY + 54} width={pw * 0.34} height={3.5} rx={2} fill={ink(0.25)} />
        {widths.map((wf, i) => {
          const k = marks.indexOf(i)
          const sweep = k === -1 ? 0 : clamp((frame - 22 - k * 20) / 12)
          const y = textTop + i * lineGap
          const lw = (pw - 2 * m) * wf
          return (
            <g key={i}>
              {k !== -1 ? (
                <rect
                  x={px + m - 4}
                  y={y - 5}
                  width={(lw + 8) * sweep}
                  height={11}
                  rx={3}
                  fill={lime(0.3)}
                />
              ) : null}
              <rect
                x={px + m}
                y={y - 1.5}
                width={lw}
                height={3.5}
                rx={2}
                fill={sweep > 0.5 ? lime(0.85) : ink(0.2)}
              />
            </g>
          )
        })}
      </g>
      {marks.map((line, k) => {
        const y = textTop + line * lineGap
        const p = clamp((frame - 32 - k * 20) / 16)
        const chipY = padY + 24 + k * ((ph - 70) / 2.6)
        const s = pop(frame, 36 + k * 20)
        return (
          <g key={k}>
            <path
              d={`M ${px + pw - m + 4} ${y} L ${noteX - 18} ${y} L ${noteX - 18} ${chipY + 22} L ${noteX} ${chipY + 22}`}
              fill="none"
              stroke={lime(0.5)}
              strokeWidth={1.8}
              strokeLinejoin="round"
              {...draw(p)}
            />
            <g
              transform={`translate(${noteX} ${chipY + 22}) scale(${s}) translate(${-0} ${-22})`}
              opacity={clamp(s)}
            >
              <rect width={noteW} height={44} rx={10} fill="#151519" stroke={ink(0.14)} />
              <circle cx={18} cy={22} r={5} fill={COLOR.accent} />
              <rect x={34} y={14} width={noteW * 0.55} height={4.5} rx={2.2} fill={ink(0.55)} />
              <rect x={34} y={26} width={noteW * 0.35} height={4.5} rx={2.2} fill={ink(0.22)} />
            </g>
          </g>
        )
      })}
    </ArtStage>
  )
}
