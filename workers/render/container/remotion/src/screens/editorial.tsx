import { interpolate, useCurrentFrame } from 'remotion'
import { Pop, Rise, easeOut } from '../fx'
import { keyPhraseIn } from '../lib/extract'
import { captionFor, focusOrigin } from '../lib/images'
import { clipWords, plainText } from '../lib/table'
import { fitText } from '../lib/text'
import { SourceChip } from '../Marks'
import { COLOR, CONTENT_TOP, CONTENT_W, H, LOW_TOP, MONO, SAFE, W, ZONE_BOTTOM } from '../theme'
import { Chip, Page, Photo, Sweep, imageAt, prop, type ScreenProps } from './ui'

export function PaperPage({ frames, ctx, props, topPad }: ScreenProps) {
  const paper = ctx.facts.paper
  const abstract = paper?.abstract ?? prop<string>(props, 'summary', ctx.hook)
  const label = paper?.abstract ? 'Abstract' : 'Summary'
  const body =
    abstract.length > 250 ? `${abstract.slice(0, 247).replace(/\s+\S*$/, '')}...` : abstract
  const phrase = prop<string>(props, 'phrase', '') || keyPhraseIn(body, 2, 4)
  const id = /arxiv\.org\/(?:abs|pdf)\/([^\s?]+)/.exec(ctx.domain)?.[1] ?? ''
  const size = fitText(
    ctx.title,
    { width: CONTENT_W, height: 330 },
    { min: 50, max: 76, charWidth: 0.56, lineHeight: 1.12 },
  )
  return (
    <Page frames={frames} tint={COLOR.arxiv} topPad={topPad}>
      <Rise>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <Chip size={32} bg={COLOR.arxiv} color="#fff">
            arXiv{id ? `:${id}` : ''}
          </Chip>
          {paper?.upvotes !== undefined ? <Chip size={32}>{paper.upvotes} upvotes</Chip> : null}
        </div>
        <div
          style={{
            fontSize: size,
            fontWeight: 800,
            lineHeight: 1.12,
            letterSpacing: '-0.03em',
            marginTop: 30,
          }}
        >
          {ctx.title}
        </div>
        {paper?.authors?.length ? (
          <div style={{ fontSize: 36, color: COLOR.muted, marginTop: 24, fontWeight: 500 }}>
            {paper.authors.slice(0, 4).join(', ')}
            {paper.authors.length > 4 ? ' et al.' : ''}
          </div>
        ) : null}
      </Rise>
      <div style={{ height: 3, background: COLOR.line, margin: '36px 0 30px' }} />
      <div
        style={{
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: COLOR.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 42,
          lineHeight: 1.32,
          marginTop: 20,
          fontWeight: 500,
          color: '#d4d4d8',
          maxHeight: 400,
          overflow: 'hidden',
        }}
      >
        <Sweep text={body} phrase={phrase} frames={frames} />
      </div>
    </Page>
  )
}

export function FigureZoom({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const img = imageAt(ctx, props)
  const p = easeOut(
    interpolate(frame, [4, frames * 0.8], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  )
  const variant = prop<number>(props, 'variant', 0)
  const origins = ['28% 30%', '72% 34%', '30% 72%', '70% 70%']
  if (!img) return <Page frames={frames} topPad={topPad} />
  const alt = plainText(img.alt ?? '').replace(/^\s*fig(?:ure|\.)?\s*\d+[a-z]?\s*[:.\-]?\s*/i, '')
  const top = CONTENT_TOP + topPad + 8
  return (
    <Page frames={frames} bleed topPad={topPad}>
      <Photo
        image={img}
        frames={frames}
        y={0}
        h={H}
        maxUp={1.2}
        zoomTo={1.2}
        origin={focusOrigin(img, origins[variant % 4]!)}
        pan={0}
        keepInFrame
      />
      <div
        style={{
          position: 'absolute',
          left: SAFE.left,
          top,
          transform: `scale(${0.8 + 0.2 * p})`,
          transformOrigin: '0 0',
        }}
      >
        <Pop>
          <Chip size={40} bg={COLOR.accent} color={COLOR.accentInk}>
            {captionFor(img, ctx.domain)}
          </Chip>
        </Pop>
      </div>
      {alt ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: W,
            top: LOW_TOP,
            padding: `30px ${SAFE.right}px 0 ${SAFE.left}px`,
            height: H,
            background: 'linear-gradient(to bottom, rgba(9,9,11,0.0), rgba(9,9,11,0.92) 30%)',
            fontSize: 36,
            lineHeight: 1.3,
            color: '#e4e4e7',
            fontWeight: 500,
          }}
        >
          {clipWords(alt, 150)}
        </div>
      ) : null}
    </Page>
  )
}

export function ArticleHeadline({ frames, ctx, props, topPad }: ScreenProps) {
  const img = imageAt(ctx, props)
  const site = ctx.facts.article?.site ?? ctx.domain
  const size = fitText(
    ctx.title,
    { width: CONTENT_W, height: 160 },
    { min: 44, max: 68, charWidth: 0.58, lineHeight: 1.1 },
  )
  const phrase = prop<string>(props, 'phrase', '') || keyPhraseIn(ctx.title, 2, 3)
  const imgH = topPad > 0 ? 300 : 440
  const top = CONTENT_TOP + topPad + 8
  return (
    <Page frames={frames} bleed topPad={topPad}>
      {img ? <Photo image={img} frames={frames} y={0} h={H} maxUp={0.01} /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(9,9,11,0.55), rgba(9,9,11,0.82))',
        }}
      />
      {img ? (
        <Photo
          image={img}
          frames={frames}
          x={0}
          y={top}
          w={W}
          h={imgH}
          backdrop={false}
          maxUp={2}
          zoomTo={1.1}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: SAFE.left,
          right: SAFE.right,
          top: top + (img ? imgH + 30 : 40),
        }}
      >
        <Pop>
          <SourceChip source={ctx.source} label={site} size={1.6} />
        </Pop>
        <div
          style={{
            fontSize: size,
            fontWeight: 900,
            lineHeight: 1.1,
            letterSpacing: '-0.035em',
            marginTop: 24,
          }}
        >
          <Sweep text={ctx.title} phrase={phrase} frames={frames} />
        </div>
      </div>
    </Page>
  )
}

export function ImageFull({ frames, ctx, props, topPad }: ScreenProps) {
  const img = imageAt(ctx, props)
  const variant = prop<number>(props, 'variant', 0)
  if (!img) return <Page frames={frames} topPad={topPad} />
  const origins = ['50% 40%', '30% 50%', '70% 55%', '50% 65%']
  const padded = topPad > 0
  const top = CONTENT_TOP + topPad + 8
  return (
    <Page frames={frames} bleed topPad={topPad}>
      {padded ? (
        <>
          <Photo image={img} frames={frames} maxUp={0.01} />
          <Photo
            image={img}
            frames={frames}
            y={top}
            h={ZONE_BOTTOM - top}
            backdrop={false}
            maxUp={1.6}
            zoomTo={1.1}
            radius={20}
            pan={variant % 2 === 0 ? -20 : 20}
          />
        </>
      ) : (
        <Photo
          image={img}
          frames={frames}
          maxUp={1.6}
          zoomTo={1.12}
          origin={focusOrigin(img, origins[variant % 4]!)}
          pan={variant % 2 === 0 ? -30 : 30}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, rgba(9,9,11,0.5) 0%, rgba(9,9,11,0) 26%, rgba(9,9,11,0) 60%, rgba(9,9,11,0.72) 100%)',
        }}
      />
      <div style={{ position: 'absolute', left: SAFE.left, top: LOW_TOP + 40 }}>
        <Pop delay={6}>
          <SourceChip source={ctx.source} label={ctx.domain} size={1.6} />
        </Pop>
      </div>
    </Page>
  )
}
