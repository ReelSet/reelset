import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { Pop, Rise, easeOut, useSpring } from '../fx'
import { fitText } from '../lib/text'
import { fitWords, styleOf, typeset } from '../lib/typeset'
import { SourceChip } from '../Marks'
import {
  COLOR,
  CONTENT_TOP,
  CONTENT_W,
  FONT,
  H,
  LOW_TOP,
  SAFE,
  W,
  ZONE_BOTTOM,
  ZONE_H,
} from '../theme'
import { Chip, Page, Photo, prop, useBackdrop, type ScreenProps } from './ui'

/** Domain strip under a key point: where this came from. */
function DomainMark({ ctx, topPad }: Pick<ScreenProps, 'ctx' | 'topPad'>) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: LOW_TOP - CONTENT_TOP - topPad + 30,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontSize: 40,
        fontWeight: 700,
        color: COLOR.muted,
      }}
    >
      <i style={{ width: 14, height: 14, borderRadius: 7, background: COLOR.accent }} />
      {ctx.domain.length > 40 ? `${ctx.domain.slice(0, 39)}…` : ctx.domain}
    </div>
  )
}

/**
 * A spoken list, one layout for every item: each row lands when its item is said (`times`,
 * seconds into the shot), the item being said is lit, the ones before stay, the rest wait.
 */
function ListCard({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const items = (props.items as unknown[]).map((i) => typeset(String(i)))
  const times = Array.isArray(props.times)
    ? (props.times as number[])
    : items.map((_, i) => i * 0.6)
  const kicker = typeset(prop<string>(props, 'kicker', ''))
  const t = frame / fps
  const said = times.filter((x) => x <= t + 0.05).length
  const current = Math.max(0, said - 1)
  const longest = items.reduce((a, b) => (b.length > a.length ? b : a), '')
  const rowH = Math.min(150, (ZONE_H - topPad - (kicker ? 120 : 0)) / items.length)
  const size = Math.min(
    fitWords(
      longest,
      { width: CONTENT_W - 90, height: rowH * 0.9 },
      { min: 40, max: 120, lineHeight: 1 },
    ),
    rowH * 0.78,
  )
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          height: ZONE_H - topPad,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {kicker ? (
          <div
            style={{
              fontSize: 46,
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: COLOR.muted,
              marginBottom: 34,
            }}
          >
            {kicker}
          </div>
        ) : null}
        {items.map((item, i) => {
          const at = (times[i] ?? 0) * fps
          const shown = frame >= at - 1
          const on = i === current && shown
          const k = easeOut(
            interpolate(frame, [at - 1, at + 6], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          )
          return (
            <div
              key={i}
              style={{
                height: rowH,
                display: 'flex',
                alignItems: 'center',
                gap: 30,
                opacity: shown ? (on ? 1 : 0.62) * (0.3 + 0.7 * k) : 0.18,
                transform: `translateX(${(1 - k) * -40}px)`,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  flexShrink: 0,
                  background: on ? COLOR.accent : shown ? COLOR.text : COLOR.dim,
                }}
              />
              <div
                style={{
                  fontSize: size,
                  fontWeight: 900,
                  letterSpacing: '-0.035em',
                  lineHeight: 1,
                  color: on ? COLOR.accent : COLOR.text,
                  whiteSpace: 'nowrap',
                }}
              >
                {item}
              </div>
            </div>
          )
        })}
      </div>
      <DomainMark ctx={ctx} topPad={topPad} />
    </Page>
  )
}

export function KeyPoint(screen: ScreenProps) {
  if (Array.isArray(screen.props.items) && screen.props.items.length > 0)
    return <ListCard {...screen} />
  return <TextPoint {...screen} />
}

function TextPoint({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const text = typeset(
    (typeof props.text === 'string' ? props.text : '').replace(/\s+/g, ' ').trim(),
  )
  const sub = typeset(prop<string>(props, 'sub', ''))
  const quote = prop<string>(props, 'quote', '')
  const by = prop<string>(props, 'by', '')
  const words = text.split(' ')
  const style = styleOf(typeof props.text === 'string' ? props.text : '')
  const upper = style === 1
  const size = quote
    ? fitText(
        text,
        { width: CONTENT_W, height: ZONE_H - topPad - (sub ? 180 : 40) },
        { min: 64, max: 78, charWidth: 0.66, lineHeight: 1.02 },
      )
    : fitWords(
        text,
        { width: CONTENT_W - 8, height: ZONE_H - topPad - (sub ? 180 : 40) },
        { min: 44, max: 200, upper, lineHeight: 1.04 },
      )
  // The whole phrase is on screen within ~0.2 s, so no frame ever shows half an idea.
  const per = words.length > 1 ? Math.min(2, Math.floor(6 / (words.length - 1))) : 0
  const clip = useBackdrop()
  if (!text && !quote) {
    return (
      <Page frames={frames} topPad={topPad}>
        {clip ? (
          <AbsoluteFill
            style={{
              left: -SAFE.left,
              top: -(CONTENT_TOP + topPad),
              width: W,
              height: H,
              opacity: 0.55,
            }}
          >
            <OffthreadVideo
              src={staticFile(clip.src)}
              startFrom={Math.round((clip.at ?? 0) * 30)}
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </AbsoluteFill>
        ) : null}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: LOW_TOP - CONTENT_TOP - topPad + 30,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 40,
            fontWeight: 700,
            color: COLOR.muted,
          }}
        >
          <i style={{ width: 14, height: 14, borderRadius: 7, background: COLOR.accent }} />
          {ctx.domain.length > 40 ? `${ctx.domain.slice(0, 39)}…` : ctx.domain}
        </div>
      </Page>
    )
  }
  const accentIdx = words.length - 1
  const bar = easeOut(
    interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          height: ZONE_H - topPad,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 180 * bar,
            height: 14,
            background: COLOR.accent,
            borderRadius: 7,
            marginBottom: 44,
          }}
        />
        {quote ? (
          <Rise>
            <div style={{ fontSize: 200, lineHeight: 0.6, color: COLOR.accent, fontWeight: 900 }}>
              “
            </div>
            <div
              style={{
                fontSize: size,
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                marginTop: 20,
              }}
            >
              {quote.length > 170 ? `${quote.slice(0, 167)}...` : quote}
            </div>
            {by ? (
              <div style={{ fontSize: 44, color: COLOR.muted, marginTop: 34, fontWeight: 600 }}>
                — {by}
              </div>
            ) : null}
          </Rise>
        ) : (
          <div
            style={{
              fontSize: size,
              fontWeight: 900,
              lineHeight: 1.02,
              letterSpacing: '-0.045em',
              textAlign: style === 2 ? 'right' : 'left',
              textTransform: upper ? 'uppercase' : undefined,
              overflowWrap: 'anywhere',
            }}
          >
            {words.map((w, i) => (
              <Pop
                key={i}
                delay={i * per}
                style={{
                  display: 'inline-block',
                  marginRight: '0.22em',
                  color: i === accentIdx ? COLOR.accent : COLOR.text,
                }}
              >
                {w}
              </Pop>
            ))}
          </div>
        )}
        {sub ? (
          <Rise
            delay={Math.min(20, words.length * per + 4)}
            style={{
              fontSize: 50,
              color: COLOR.muted,
              marginTop: 36,
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {sub}
          </Rise>
        ) : null}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: LOW_TOP - CONTENT_TOP - topPad + 30,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 40,
          fontWeight: 700,
          color: COLOR.muted,
        }}
      >
        <i style={{ width: 14, height: 14, borderRadius: 7, background: COLOR.accent }} />
        {ctx.domain.length > 40 ? `${ctx.domain.slice(0, 39)}…` : ctx.domain}
      </div>
    </Page>
  )
}

/** What the reel was about, by name: the repo, the paper's short name, else the source title. */
export function endName(ctx: ScreenProps['ctx']): string {
  const r = ctx.facts.repo
  if (r?.owner && r.name) return `${r.owner}/${r.name}`
  if (ctx.demo?.repo) return ctx.demo.repo
  const head = /^([^:]{2,24}):\s/.exec(ctx.title)?.[1]
  if (ctx.source === 'papers' && head) return head
  return ctx.title
}

export function EndCard({ frames, ctx, topPad }: ScreenProps) {
  const pulse = useSpring(20, 8, 0.5)
  const name = typeset(endName(ctx))
  const sub = name === ctx.title ? ctx.domain : ctx.title
  const size = fitText(
    name,
    { width: CONTENT_W, height: 260 },
    { min: 56, max: 120, charWidth: 0.58, lineHeight: 1.05 },
  )
  const backdrop = useBackdrop()
  const cover = ctx.images.find((i) => i.kind !== 'avatar' && i.kind !== 'figure') ?? ctx.images[0]
  const top = CONTENT_TOP + topPad + 30
  const cardTop = top + 470
  const cardH = ZONE_BOTTOM - cardTop
  return (
    <Page frames={frames} bleed topPad={topPad}>
      {cover && !backdrop ? <Photo image={cover} frames={frames} backdropOnly /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: cover && !backdrop ? 'rgba(9,9,11,0.7)' : 'transparent',
        }}
      />
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top }}>
        <Rise
          style={{
            fontSize: size,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            overflowWrap: 'anywhere',
            maxHeight: 280,
            overflow: 'hidden',
          }}
        >
          {name}
        </Rise>
        <Rise
          delay={6}
          style={{
            fontSize: 44,
            color: COLOR.muted,
            fontWeight: 600,
            marginTop: 26,
            lineHeight: 1.25,
            maxHeight: 112,
            overflow: 'hidden',
          }}
        >
          {sub}
        </Rise>
      </div>
      {cover && cardH > 200 ? (
        <Pop delay={8}>
          <Photo
            image={cover}
            frames={frames}
            x={SAFE.left}
            y={cardTop}
            w={W - SAFE.left - SAFE.right}
            h={cardH}
            backdrop={false}
            maxUp={1.6}
            zoomTo={1.04}
            radius={28}
          />
        </Pop>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: SAFE.left,
          right: SAFE.right,
          top: LOW_TOP + 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 26,
        }}
      >
        <div
          style={{
            transform: `scale(${interpolate(pulse, [0, 1], [0.8, 1])})`,
            transformOrigin: '0 50%',
          }}
        >
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
