import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { Pop, Rise, easeOut, useSpring } from '../fx'
import { parseStat } from '../lib/count'
import { displayStat, tidyDecimals } from '../lib/stat-format'
import { barValueWidth } from '../lib/looks'
import { fitText } from '../lib/text'
import { typeset } from '../lib/typeset'
import { SourceChip } from '../Marks'
import { COLOR, CONTENT_W, LOW_TOP, CONTENT_TOP, SAFE, ZONE_H } from '../theme'
import { Page, prop, type ScreenProps } from './ui'

export function StatSlam({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const raw = prop<string>(props, 'value', '')
  const label = prop<string>(props, 'label', '')
  // The real number from the first frame: a count-up would show values nobody said ("47.0%" on the way to 94.7%).
  const shown = displayStat(raw, label)
  const fade = interpolate(frame, [0, 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const size = fitText(
    shown || '0',
    { width: CONTENT_W, height: 380 },
    { min: 110, max: 300, charWidth: 0.62, lineHeight: 1 },
  )
  const slam = useSpring(0, 9, 0.5)
  const bar = easeOut(
    interpolate(frame, [10, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          position: 'relative',
          height: ZONE_H - topPad,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {[0, 1, 2].map((i) => {
          const t = ((frame / 40 + i / 3) % 1) as number
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '46%',
                width: 360 + t * 760,
                height: 360 + t * 760,
                marginLeft: -(180 + t * 380),
                marginTop: -(180 + t * 380),
                borderRadius: '50%',
                border: `3px solid rgba(200,247,81,${0.28 * (1 - t)})`,
              }}
            />
          )
        })}
        <div
          style={{
            position: 'relative',
            fontSize: size,
            fontWeight: 900,
            letterSpacing: '-0.05em',
            lineHeight: 1,
            color: COLOR.accent,
            fontVariantNumeric: 'tabular-nums',
            // Grows into place from below its size: a slam that starts larger would cross the safe edge.
            transform: `scale(${interpolate(slam, [0, 1], [0.82, 1])})`,
            transformOrigin: '0% 60%',
            opacity: fade,
            textShadow: '0 0 90px rgba(200,247,81,0.38)',
          }}
        >
          {shown}
        </div>
        <div
          style={{
            height: 14,
            width: `${bar * 100}%`,
            background: COLOR.accent,
            borderRadius: 7,
            marginTop: 30,
          }}
        />
        {label ? (
          <Rise
            delay={8}
            style={{
              marginTop: 34,
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1.1,
              textTransform: 'uppercase',
              letterSpacing: '-0.01em',
            }}
          >
            {label}
          </Rise>
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: 0, top: LOW_TOP - CONTENT_TOP - topPad + 20 }}>
        <Pop delay={14}>
          <SourceChip source={ctx.source} label={ctx.domain} size={1.7} />
        </Pop>
      </div>
    </Page>
  )
}

type Bar = { label: string; value: string }

/**
 * Two (or more) numbers of one comparison. Each bar names whose number it is, the title says what
 * was measured; the value sits outside its bar so it always reads. With `times` (seconds into the
 * shot) a bar grows when its number is said.
 */
export function BarRace({ frames, props, ctx, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const bars = prop<Bar[]>(props, 'bars', [])
    .slice(0, 4)
    .map((b) => ({ ...b, value: tidyDecimals(b.value) }))
  const title = typeset(prop<string>(props, 'title', ''))
  const times = Array.isArray(props.times) ? (props.times as number[]) : null
  const parsed = bars.map((b) => ({ ...b, stat: parseStat(b.value) }))
  const max = Math.max(...parsed.map((b) => b.stat?.value ?? 0), 1)
  const same = new Set(parsed.map((b) => b.stat?.suffix.trim())).size === 1
  // The value column fits the longest value on one line ("~20 min" never wraps).
  const valueW = barValueWidth(bars.map((b) => b.value))
  const track = CONTENT_W - valueW - 24
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 54,
          justifyContent: 'center',
          height: ZONE_H - topPad,
        }}
      >
        {title ? (
          <div
            style={{
              fontSize: 50,
              fontWeight: 800,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              color: COLOR.muted,
            }}
          >
            {title}
          </div>
        ) : null}
        {parsed.map((b, i) => {
          // Every bar and value is on screen from the first frame (no empty tracks): bars grow in
          // within 8 frames, and the one being said gets a brief glow.
          const grow = easeOut(
            interpolate(frame, [i * 2, i * 2 + 8], [0.15, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          )
          const said = times ? (times[i] ?? 0) * fps : -1
          const glow =
            said > 2
              ? interpolate(frame, [said, said + 4, said + 20], [0, 1, 0], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })
              : 0
          const v = b.stat?.value ?? 0
          const width = same ? Math.max(0.06, v / max) : 1
          const color = i === 0 ? COLOR.accent : '#7c8cff'
          return (
            <div key={i}>
              <div
                style={{
                  fontSize: 56,
                  fontWeight: 800,
                  marginBottom: 16,
                  letterSpacing: '-0.02em',
                  color: COLOR.text,
                }}
              >
                {typeset(b.label)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div
                  style={{
                    position: 'relative',
                    width: track,
                    height: 92,
                    borderRadius: 20,
                    background: 'rgba(255,255,255,0.07)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${width * grow * 100}%`,
                      height: '100%',
                      background: color,
                      borderRadius: 20,
                      boxShadow: glow > 0 ? `0 0 ${60 * glow}px ${color}` : undefined,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: valueW,
                    fontSize: 84,
                    fontWeight: 900,
                    letterSpacing: '-0.04em',
                    color,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.value}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: LOW_TOP - CONTENT_TOP - topPad + 20,
          fontSize: 36,
          color: COLOR.dim,
          fontWeight: 600,
        }}
      >
        {ctx.domain}
      </div>
    </Page>
  )
}

export function Compare({ frames, props, ctx, topPad }: ScreenProps) {
  const left = prop<string>(props, 'left', 'Before')
  const right = prop<string>(props, 'right', 'After')
  const vs = useSpring(10, 9, 0.5)
  const side = (text: string, color: string, ink: string, delay: number) => {
    const size = fitText(
      text,
      { width: CONTENT_W - 80, height: 220 },
      { min: 56, max: 130, charWidth: 0.6, lineHeight: 1.05 },
    )
    return (
      <Pop delay={delay} style={{ width: '100%' }}>
        <div
          style={{
            background: color,
            color: ink,
            borderRadius: 40,
            padding: '56px 48px',
            fontSize: size,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            minHeight: 270,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {text}
        </div>
      </Pop>
    )
  }
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          position: 'relative',
          height: ZONE_H - topPad,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {side(left, 'rgba(255,255,255,0.1)', COLOR.text, 0)}
        <div
          style={{
            alignSelf: 'center',
            zIndex: 2,
            width: 130,
            height: 130,
            borderRadius: 65,
            background: COLOR.accent,
            color: COLOR.accentInk,
            fontSize: 54,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${interpolate(vs, [0, 1], [0, 1])}) rotate(${interpolate(vs, [0, 1], [-40, 0])}deg)`,
            margin: '-40px 0',
          }}
        >
          VS
        </div>
        {side(right, COLOR.accent, COLOR.accentInk, 6)}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: LOW_TOP - CONTENT_TOP - topPad + 20,
          fontSize: 36,
          color: COLOR.dim,
          fontWeight: 600,
        }}
      >
        {ctx.domain}
      </div>
    </Page>
  )
}
