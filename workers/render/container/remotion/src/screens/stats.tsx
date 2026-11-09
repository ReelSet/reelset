import { interpolate, useCurrentFrame } from 'remotion'
import { Pop, Rise, easeOut, useSpring } from '../fx'
import { formatStat, parseStat } from '../lib/count'
import { fitText } from '../lib/text'
import { SourceChip } from '../Marks'
import { COLOR, CONTENT_W, LOW_TOP, CONTENT_TOP, SAFE, ZONE_H } from '../theme'
import { Page, prop, useCount, type ScreenProps } from './ui'

export function StatSlam({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const raw = prop<string>(props, 'value', '')
  const label = prop<string>(props, 'label', '')
  const stat = parseStat(raw)
  const p = useCount(frames, 0.45, 3)
  const shown = stat ? formatStat(stat, p) : raw
  const size = fitText(raw || '0', { width: CONTENT_W, height: 380 }, { min: 110, max: 300, charWidth: 0.62, lineHeight: 1 })
  const slam = useSpring(0, 9, 0.5)
  const bar = easeOut(interpolate(frame, [10, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
  return (
    <Page frames={frames} topPad={topPad}>
      <div style={{ position: 'relative', height: ZONE_H - topPad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
            transform: `scale(${interpolate(slam, [0, 1], [1.35, 1])})`,
            transformOrigin: '0% 60%',
            textShadow: '0 0 90px rgba(200,247,81,0.38)',
          }}
        >
          {shown}
        </div>
        <div style={{ height: 14, width: `${bar * 100}%`, background: COLOR.accent, borderRadius: 7, marginTop: 30 }} />
        {label ? (
          <Rise delay={8} style={{ marginTop: 34, fontSize: 64, fontWeight: 800, lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
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

export function BarRace({ frames, props, ctx, topPad }: ScreenProps) {
  const bars = prop<Bar[]>(props, 'bars', []).slice(0, 4)
  const parsed = bars.map((b) => ({ ...b, stat: parseStat(b.value) }))
  const max = Math.max(...parsed.map((b) => b.stat?.value ?? 0), 1)
  const p = useCount(frames, 0.6, 4)
  const same = new Set(parsed.map((b) => b.stat?.suffix.trim())).size === 1
  return (
    <Page frames={frames} topPad={topPad}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 58, justifyContent: 'center', height: ZONE_H - topPad }}>
        {parsed.map((b, i) => {
          const v = b.stat?.value ?? 0
          const width = same ? Math.max(0.08, v / max) : 1
          return (
            <Pop key={i} delay={i * 5}>
              <div style={{ fontSize: 46, fontWeight: 700, color: COLOR.muted, marginBottom: 14, textTransform: 'capitalize' }}>{b.label}</div>
              <div style={{ position: 'relative', height: 130, borderRadius: 24, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{ width: `${width * p * 100}%`, height: '100%', background: i === 0 ? COLOR.accent : '#7c8cff', borderRadius: 24 }} />
                <div style={{ position: 'absolute', right: 34, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 72, fontWeight: 900, color: width * p > 0.7 ? COLOR.accentInk : COLOR.text, fontVariantNumeric: 'tabular-nums' }}>
                  {b.stat ? formatStat(b.stat, p) : b.value}
                </div>
              </div>
            </Pop>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 0, top: LOW_TOP - CONTENT_TOP - topPad + 20, fontSize: 36, color: COLOR.dim, fontWeight: 600 }}>
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
    const size = fitText(text, { width: CONTENT_W - 80, height: 220 }, { min: 56, max: 130, charWidth: 0.6, lineHeight: 1.05 })
    return (
      <Pop delay={delay} style={{ width: '100%' }}>
        <div style={{ background: color, color: ink, borderRadius: 40, padding: '56px 48px', fontSize: size, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.05, minHeight: 270, display: 'flex', alignItems: 'center' }}>
          {text}
        </div>
      </Pop>
    )
  }
  return (
    <Page frames={frames} topPad={topPad}>
      <div style={{ position: 'relative', height: ZONE_H - topPad, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {side(left, 'rgba(255,255,255,0.1)', COLOR.text, 0)}
        <div style={{ alignSelf: 'center', zIndex: 2, width: 130, height: 130, borderRadius: 65, background: COLOR.accent, color: COLOR.accentInk, fontSize: 54, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${interpolate(vs, [0, 1], [0, 1])}) rotate(${interpolate(vs, [0, 1], [-40, 0])}deg)`, margin: '-40px 0' }}>
          VS
        </div>
        {side(right, COLOR.accent, COLOR.accentInk, 6)}
      </div>
      <div style={{ position: 'absolute', left: 0, top: LOW_TOP - CONTENT_TOP - topPad + 20, fontSize: 36, color: COLOR.dim, fontWeight: 600 }}>{ctx.domain}</div>
    </Page>
  )
}

