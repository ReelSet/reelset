import { Rise, easeOut, useProgress } from '../fx'
import { formatStat, parseStat } from '../lib/count'
import { COLOR, CONTENT_W, FONT, SAFE, SCENE_H, SCENE_TOP } from '../theme'

function valueSize(text: string): number {
  if (text.length <= 5) return 168
  if (text.length <= 8) return 128
  if (text.length <= 12) return 92
  return 62
}

export function StatScene({
  label,
  value,
  frames,
}: {
  label: string
  value: string
  frames: number
}) {
  const stat = parseStat(value)
  const p = easeOut(useProgress(Math.min(frames * 0.6, 54), 6))
  const shown = stat ? formatStat(stat, p) : value
  const size = valueSize(stat ? formatStat(stat, 1) : value)
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: SCENE_TOP,
        width: CONTENT_W,
        height: SCENE_H,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: '-0.05em',
          color: COLOR.text,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {shown}
      </div>
      <div
        style={{
          height: 4,
          width: CONTENT_W * 0.5 * p,
          background: COLOR.accent,
          borderRadius: 2,
          margin: '30px 0 26px',
        }}
      />
      <Rise delay={8}>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 500,
            fontSize: 32,
            lineHeight: 1.25,
            letterSpacing: '-0.015em',
            color: COLOR.muted,
            maxWidth: CONTENT_W,
          }}
        >
          {label}
        </div>
      </Rise>
    </div>
  )
}
