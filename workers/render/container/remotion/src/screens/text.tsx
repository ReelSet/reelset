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
import { accentIndex } from '../lib/emphasis'
import { listSize } from '../lib/lists'
import { fitWords, displayTitle, styleOf, typeset } from '../lib/typeset'
import { PLATE_FULL_H, PLATE_H, plateFact, textPlan } from '../lib/fill'
import { endName, endSource, endSubtitle } from '../lib/endcard'
import { SourceChip } from '../Marks'
import { COLOR, CONTENT_TOP, CONTENT_W, H, LOW_TOP, SAFE, W, ZONE_H } from '../theme'
import { Chip, Page, Photo, imageAt, prop, useBackdrop, type ScreenProps } from './ui'

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
  const size = listSize(items, CONTENT_W - 60, ZONE_H - topPad - (kicker ? 120 : 0))
  if (props.layout === 1) return <ListPills {...{ frames, ctx, props, topPad }} />
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
                minHeight: size * 1.25,
                padding: `${Math.round(size * 0.12)}px 0`,
                display: 'flex',
                alignItems: 'center',
                gap: 30,
                opacity: shown ? (on ? 1 : 0.62) * (0.45 + 0.55 * k) : 0.4,
                transform: `translateX(${(1 - k) * 28}px)`,
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
                  overflowWrap: 'normal',
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

/**
 * The other list layout (the second card of a long list, or of a terms card): items centred in
 * pills, the one being said filled with the accent. A visibly new frame, same honest content.
 */
function ListPills({ frames, ctx, props, topPad }: ScreenProps) {
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
  const size = Math.min(
    112,
    listSize(items, CONTENT_W - 140, ZONE_H - topPad - (kicker ? 140 : 0) - items.length * 60),
  )
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          height: ZONE_H - topPad,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          gap: 30,
        }}
      >
        {kicker ? (
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: COLOR.muted,
              marginBottom: 10,
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
                maxWidth: CONTENT_W,
                padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.45)}px`,
                borderRadius: 999,
                background: on ? COLOR.accent : 'rgba(255,255,255,0.08)',
                border: `3px solid ${on ? COLOR.accent : 'rgba(255,255,255,0.16)'}`,
                color: on ? COLOR.accentInk : COLOR.text,
                fontSize: size,
                fontWeight: 900,
                letterSpacing: '-0.03em',
                lineHeight: 1.05,
                opacity: shown ? 0.5 + 0.5 * k : 0.35,
                transform: `scale(${0.9 + 0.1 * k})`,
              }}
            >
              {item}
            </div>
          )
        })}
      </div>
      <DomainMark ctx={ctx} topPad={topPad} />
    </Page>
  )
}

export function KeyPoint(screen: ScreenProps) {
  if (screen.props.hook === true) return <HookHeadline {...screen} />
  if (Array.isArray(screen.props.items) && screen.props.items.length > 0)
    return <ListCard {...screen} />
  return <TextPoint {...screen} />
}

/**
 * The item itself under a key point: its source chip, its title and, when the facts have one, a big
 * number (stars, points, upvotes, views). It fills what a short statement leaves empty, with real
 * material about the story rather than decoration.
 */
function ContextPlate({
  ctx,
  big = false,
  count = true,
}: {
  ctx: ScreenProps['ctx']
  big?: boolean
  count?: boolean
}) {
  const fact = count ? plateFact(ctx.source, ctx.facts) : null
  // A repo's release or commit title is not a name: the plate shows the repo itself.
  const title = ctx.source === 'github' ? endName(ctx) : displayTitle(ctx.title)
  const longest = Math.max(...title.split(/\s+/).map((w) => w.length))
  const titleSize = big ? (fact && longest > 9 ? 54 : 68) : 44
  return (
    <Rise
      delay={6}
      style={{
        width: '100%',
        height: big ? PLATE_FULL_H : PLATE_H,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 36,
        padding: big ? '0 52px' : '0 40px',
        borderRadius: 36,
        background: 'rgba(255,255,255,0.06)',
        border: `2px solid ${COLOR.line}`,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <SourceChip source={ctx.source} label={ctx.sourceLabel} size={big ? 2 : 1.5} />
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.12,
            letterSpacing: '-0.025em',
            marginTop: big ? 36 : 22,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: big ? 6 : 3,
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
        <div
          style={{ fontSize: big ? 40 : 32, fontWeight: 600, color: COLOR.muted, marginTop: 18 }}
        >
          {ctx.domain.length > 36 ? `${ctx.domain.slice(0, 35)}…` : ctx.domain}
        </div>
      </div>
      {fact ? (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div
            style={{
              fontSize: big ? 170 : 104,
              fontWeight: 900,
              letterSpacing: '-0.05em',
              lineHeight: 1,
              color: COLOR.accent,
            }}
          >
            {fact.value}
          </div>
          <div
            style={{
              fontSize: big ? 40 : 30,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: COLOR.muted,
              marginTop: 8,
            }}
          >
            {fact.label}
          </div>
        </div>
      ) : null}
    </Rise>
  )
}

/** The reel's first screen when it has nothing else real to open on: the headline, huge, over the story's image or footage. */
function HookHeadline({ frames, ctx, props }: ScreenProps) {
  const label = typeset(prop<string>(props, 'text', '')).toUpperCase()
  const words = label.split(' ')
  const img = typeof props.bgImage === 'number' ? imageAt(ctx, { image: props.bgImage }) : undefined
  const size = fitWords(
    label,
    { width: CONTENT_W, height: ZONE_H - 40 },
    { min: 72, max: 230, upper: true, lineHeight: 1.0 },
  )
  const accent = accentIndex(words)
  return (
    <Page frames={frames} bleed>
      {img ? <Photo image={img} frames={frames} backdropOnly /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0.25) 45%, rgba(9,9,11,0.7) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: SAFE.left,
          right: SAFE.right,
          top: CONTENT_TOP,
          height: ZONE_H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: size,
            fontWeight: 900,
            lineHeight: 1.0,
            letterSpacing: '-0.04em',
            overflowWrap: 'anywhere',
          }}
        >
          {words.map((w, i) => (
            <Pop
              key={i}
              delay={i * 2}
              style={{
                display: 'inline-block',
                marginRight: '0.2em',
                color: i === accent ? COLOR.accent : COLOR.text,
                textShadow: '0 6px 40px rgba(0,0,0,0.55)',
              }}
            >
              {w}
            </Pop>
          ))}
        </div>
      </div>
    </Page>
  )
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
  // One casing for every key point in a reel: sentence case (layouts differ by alignment only).
  const upper = false
  const clip = useBackdrop()
  const bare = props.bare === true
  const plan = !quote && !clip && text && !bare ? textPlan(text, sub, topPad) : null
  const size = plan
    ? plan.size
    : bare && text && !quote && !clip
      ? textPlan(text, sub, topPad, false).size
      : quote
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
  if (!text && !quote && !clip) {
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
          <ContextPlate ctx={ctx} big count={props.noCount !== true} />
        </div>
      </Page>
    )
  }
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
              opacity: 0.85,
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
  const accentIdx = accentIndex(words)
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
            alignSelf: style === 2 ? 'flex-end' : style === 1 ? 'center' : 'flex-start',
            marginRight: style === 2 ? 14 : 0,
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
              textAlign: style === 2 ? 'right' : style === 1 ? 'center' : 'left',
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
        {plan ? (
          <div style={{ marginTop: 44 }}>
            <ContextPlate ctx={ctx} count={props.noCount !== true} />
          </div>
        ) : null}
      </div>
      {plan ? null : (
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
      )}
    </Page>
  )
}

/**
 * Last card: the name big, the full title under it, where it came from, and the follow CTA. No
 * image (a small, low-contrast copy of the hook image reads as filler).
 */
export function EndCard({ frames, ctx, topPad }: ScreenProps) {
  const pulse = useSpring(20, 8, 0.5)
  const name = typeset(endName(ctx))
  const sub = typeset(endSubtitle(ctx))
  // "owner/repo" may break after the slash, never inside a word.
  const longest = Math.max(...name.split(/[\s/]+/).map((w) => w.length + 1))
  const size = Math.min(
    fitText(
      name.replace(/\//g, '/ '),
      { width: CONTENT_W, height: 380 },
      { min: 56, max: 168, charWidth: 0.6, lineHeight: 1.02 },
    ),
    Math.floor(CONTENT_W / (longest * 0.62)),
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
        <Pop>
          <SourceChip source={ctx.source} label={ctx.sourceLabel} size={1.9} />
        </Pop>
        <Rise
          delay={3}
          style={{
            fontSize: size,
            fontWeight: 900,
            letterSpacing: '-0.045em',
            lineHeight: 1.02,
            marginTop: 40,
            maxHeight: 400,
            overflow: 'hidden',
          }}
        >
          {name.replace(/\//g, '/\u200b')}
        </Rise>
        {sub ? (
          <Rise
            delay={6}
            style={{
              fontSize: 46,
              color: COLOR.muted,
              fontWeight: 650,
              marginTop: 30,
              lineHeight: 1.22,
              maxHeight: 170,
              overflow: 'hidden',
            }}
          >
            {sub}
          </Rise>
        ) : null}
        <Rise delay={9} style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 40 }}>
          <i style={{ width: 16, height: 16, borderRadius: 8, background: COLOR.accent }} />
          <span style={{ fontSize: 44, fontWeight: 800, color: COLOR.text }}>{endSource(ctx)}</span>
        </Rise>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: LOW_TOP - CONTENT_TOP - topPad + 20,
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
