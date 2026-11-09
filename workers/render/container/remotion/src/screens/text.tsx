import { interpolate, useCurrentFrame } from 'remotion'
import { Pop, Rise, easeOut, useSpring } from '../fx'
import { fitText } from '../lib/text'
import { SourceChip } from '../Marks'
import { COLOR, CONTENT_TOP, CONTENT_W, FONT, H, LOW_TOP, SAFE, W, ZONE_H } from '../theme'
import { Chip, Page, Photo, prop, type ScreenProps } from './ui'

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

export function KeyPoint({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const text = prop<string>(props, 'text', ctx.title).replace(/\s+/g, ' ').trim()
  const sub = prop<string>(props, 'sub', '')
  const quote = prop<string>(props, 'quote', '')
  const by = prop<string>(props, 'by', '')
  const words = text.split(' ')
  const style = hash(text) % 3
  const longest = Math.max(...words.map((w) => w.length), 1)
  const size = Math.min(CONTENT_W / (longest * 0.7), fitText(text, { width: CONTENT_W, height: ZONE_H - topPad - (sub ? 180 : 40) }, { min: 64, max: quote ? 78 : 200, charWidth: 0.66, lineHeight: 1.02 }))
  const per = Math.max(2, Math.min(5, Math.floor((frames * 0.5) / Math.max(1, words.length))))
  const accentIdx = words.length - 1
  const bar = easeOut(interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
  return (
    <Page frames={frames} topPad={topPad}>
      <div style={{ height: ZONE_H - topPad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ width: 180 * bar, height: 14, background: COLOR.accent, borderRadius: 7, marginBottom: 44 }} />
        {quote ? (
          <Rise>
            <div style={{ fontSize: 200, lineHeight: 0.6, color: COLOR.accent, fontWeight: 900 }}>“</div>
            <div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', marginTop: 20 }}>{quote.length > 170 ? `${quote.slice(0, 167)}...` : quote}</div>
            {by ? <div style={{ fontSize: 44, color: COLOR.muted, marginTop: 34, fontWeight: 600 }}>— {by}</div> : null}
          </Rise>
        ) : (
          <div style={{ fontSize: size, fontWeight: 900, lineHeight: 1.02, letterSpacing: '-0.045em', textAlign: style === 2 ? 'right' : 'left', textTransform: style === 1 ? 'uppercase' : undefined }}>
            {words.map((w, i) => (
              <Pop key={i} delay={i * per} style={{ display: 'inline-block', marginRight: '0.22em', color: i === accentIdx ? COLOR.accent : COLOR.text }}>
                {w}
              </Pop>
            ))}
          </div>
        )}
        {sub ? (
          <Rise delay={Math.min(20, words.length * per + 4)} style={{ fontSize: 50, color: COLOR.muted, marginTop: 36, fontWeight: 600, lineHeight: 1.2 }}>
            {sub}
          </Rise>
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: 0, top: LOW_TOP - CONTENT_TOP - topPad + 30, display: 'flex', alignItems: 'center', gap: 16, fontSize: 40, fontWeight: 700, color: COLOR.muted }}>
        <i style={{ width: 14, height: 14, borderRadius: 7, background: COLOR.accent }} />
        {ctx.domain.length > 40 ? `${ctx.domain.slice(0, 39)}…` : ctx.domain}
      </div>
    </Page>
  )
}

export function EndCard({ frames, ctx, topPad }: ScreenProps) {
  const pulse = useSpring(20, 8, 0.5)
  const name = ctx.facts.repo?.owner && ctx.facts.repo.name ? `${ctx.facts.repo.owner}/${ctx.facts.repo.name}` : ctx.domain
  const size = fitText(name, { width: CONTENT_W, height: 240 }, { min: 56, max: 110, charWidth: 0.58, lineHeight: 1.05 })
  const cover = ctx.images[0]
  return (
    <Page frames={frames} bleed topPad={topPad}>
      {cover ? <Photo image={cover} frames={frames} maxUp={0.01} /> : null}
      <div style={{ position: 'absolute', inset: 0, background: cover ? 'rgba(9,9,11,0.72)' : 'transparent' }} />
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: CONTENT_TOP + topPad + 40 }}>
        <Pop>
          <SourceChip source={ctx.source} label={ctx.sourceLabel} size={1.7} />
        </Pop>
        <Rise delay={4} style={{ fontSize: size, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.05, marginTop: 44, overflowWrap: 'anywhere' }}>
          {name}
        </Rise>
        <Rise delay={9} style={{ fontSize: 48, color: COLOR.muted, fontWeight: 600, marginTop: 28, lineHeight: 1.25 }}>
          {ctx.title}
        </Rise>
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: LOW_TOP + 20, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ transform: `scale(${interpolate(pulse, [0, 1], [0.8, 1])})`, transformOrigin: '0 50%' }}>
          <Chip size={52} bg={COLOR.accent} color={COLOR.accentInk}>
            Follow for daily dev reels
          </Chip>
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: '-0.03em' }}>
          <span style={{ color: COLOR.accent }}>■ </span>reelset.app
        </div>
      </div>
    </Page>
  )
}
