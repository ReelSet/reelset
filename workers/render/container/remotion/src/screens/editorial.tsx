import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { Pop, Rise, easeOut } from '../fx'
import { keyPhraseIn } from '../lib/extract'
import { captionFor, focusOrigin } from '../lib/images'
import { clipWords, plainText } from '../lib/table'
import { fitText, fitWindow } from '../lib/text'
import { typeset } from '../lib/typeset'
import { SourceChip } from '../Marks'
import { COLOR, CONTENT_TOP, CONTENT_W, H, LOW_TOP, MONO, SAFE, W, ZONE_BOTTOM } from '../theme'
import { Chip, Fit, Page, Photo, Sweep, imageAt, prop, type ScreenProps } from './ui'

export function PaperPage({ frames, ctx, props, topPad }: ScreenProps) {
  const paper = ctx.facts.paper
  const variant = prop<string>(props, 'variant', 'title')
  const abstract = plainText(paper?.abstract ?? prop<string>(props, 'summary', ctx.hook))
  const label = paper?.abstract ? 'Abstract' : 'Summary'
  const phrase = prop<string>(props, 'phrase', '') || keyPhraseIn(abstract, 2, 4) || ''
  const id = /arxiv\.org\/(?:abs|pdf)\/([^\s?]+)/.exec(ctx.domain)?.[1] ?? ''
  const chips = (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <Chip size={32} bg={COLOR.arxiv} color="#fff">
        arXiv{id ? `:${id}` : ''}
      </Chip>
      {paper?.upvotes !== undefined ? <Chip size={32}>{paper.upvotes} upvotes</Chip> : null}
    </div>
  )
  const smallTitle = (
    <div
      style={{
        fontSize: 38,
        fontWeight: 700,
        lineHeight: 1.2,
        marginTop: 24,
        color: COLOR.muted,
        maxHeight: 140,
        overflow: 'hidden',
      }}
    >
      {typeset(ctx.title)}
    </div>
  )
  if (variant === 'abstract') {
    const { body, size } = fitWindow(
      abstract,
      phrase,
      { width: CONTENT_W, height: ZONE_BOTTOM - CONTENT_TOP - topPad - 360 },
      { min: 46, max: 62, charWidth: 0.52, lineHeight: 1.3 },
      190,
    )
    return (
      <Page frames={frames} tint={COLOR.arxiv} topPad={topPad}>
        {chips}
        {smallTitle}
        <div style={{ height: 3, background: COLOR.line, margin: '30px 0 26px' }} />
        <div
          style={{
            fontSize: 30,
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
            fontSize: size,
            lineHeight: 1.3,
            marginTop: 18,
            fontWeight: 500,
            color: '#e4e4e7',
          }}
        >
          <Sweep text={body} phrase={phrase} frames={frames} delay={4} />
        </div>
      </Page>
    )
  }
  const figure = variant === 'figure' ? imageAt(ctx, props) : undefined
  if (figure) {
    const top = CONTENT_TOP + topPad + 250
    const h = ZONE_BOTTOM - top - 10
    return (
      <Page frames={frames} tint={COLOR.arxiv} topPad={topPad} bleed>
        <div
          style={{
            position: 'absolute',
            left: SAFE.left,
            right: SAFE.right,
            top: CONTENT_TOP + topPad,
          }}
        >
          {chips}
          {smallTitle}
        </div>
        <div
          style={{
            position: 'absolute',
            left: SAFE.left,
            right: SAFE.right,
            top,
            height: h,
            background: '#fafafa',
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          }}
        >
          <Photo
            image={figure}
            frames={frames}
            x={0}
            y={0}
            w={CONTENT_W}
            h={h}
            backdrop={false}
            maxUp={1.4}
            zoomTo={1.06}
            keepInFrame
          />
        </div>
        <div style={{ position: 'absolute', left: SAFE.left, top: top + 24 }}>
          <Pop delay={6}>
            <Chip size={34} bg={COLOR.arxiv} color="#fff">
              {captionFor(figure, 'Figure')}
            </Chip>
          </Pop>
        </div>
      </Page>
    )
  }
  const size = fitText(
    ctx.title,
    { width: CONTENT_W, height: 520 },
    { min: 56, max: 92, charWidth: 0.56, lineHeight: 1.1 },
  )
  return (
    <Page frames={frames} tint={COLOR.arxiv} topPad={topPad}>
      <Rise>
        {chips}
        <div
          style={{
            fontSize: size,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            marginTop: 34,
          }}
        >
          {typeset(ctx.title)}
        </div>
        {paper?.authors?.length ? (
          <div
            style={{
              fontSize: 38,
              color: COLOR.muted,
              marginTop: 30,
              fontWeight: 500,
              lineHeight: 1.3,
            }}
          >
            {paper.authors.slice(0, 4).join(', ')}
            {paper.authors.length > 4 ? ' et al.' : ''}
          </div>
        ) : null}
      </Rise>
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
  const iw = img.width ?? 1280
  const ih = img.height ?? 720
  const wide = iw / ih >= 1.5
  if (wide) {
    // Whole figure inside the safe box first, then a slow push toward its point of interest.
    const cardTop = top + 92
    const room = ZONE_BOTTOM - cardTop - 10
    const base = Math.min(1.2, CONTENT_W / iw)
    const cardH = Math.min(room, Math.max(ih * base, Math.round(CONTENT_W * 0.62)))
    const zoom = Math.max(1, Math.min(1.7, cardH / (ih * base), 1.2 / base))
    const z = 1 + (zoom - 1) * p
    const [fx, fy] = focusOrigin(img, variant % 2 === 0 ? '30% 50%' : '70% 50%')
      .split(' ')
      .map((v) => parseFloat(v) / 100)
    const dw = iw * base * z
    const dh = ih * base * z
    const left = Math.min(0, Math.max(CONTENT_W - dw, CONTENT_W / 2 - dw * (fx ?? 0.5)))
    const topIn =
      dh <= cardH
        ? (cardH - dh) / 2
        : Math.min(0, Math.max(cardH - dh, cardH / 2 - dh * (fy ?? 0.5)))
    return (
      <Page frames={frames} topPad={topPad}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: cardTop - (CONTENT_TOP + topPad),
            width: CONTENT_W,
            height: cardH,
            overflow: 'hidden',
            background: '#fafafa',
            borderRadius: 22,
            boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          }}
        >
          <Img
            src={staticFile(img.src)}
            style={{ position: 'absolute', left, top: topIn, width: dw, height: dh }}
          />
        </div>
        <div style={{ position: 'absolute', left: 0, top: top - (CONTENT_TOP + topPad) }}>
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
              right: 0,
              top: LOW_TOP + 30 - (CONTENT_TOP + topPad),
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
  const phrase = prop<string>(props, 'phrase', '') || keyPhraseIn(ctx.title, 2, 3)
  const top = CONTENT_TOP + topPad + 8
  const imgH = img ? (topPad > 0 ? 220 : 420) : 0
  const textTop = top + (img ? imgH + 30 : 40)
  // The headline stays above the caption band: what does not fit is set smaller, never under it.
  const room = ZONE_BOTTOM - textTop
  const size = fitText(
    ctx.title,
    { width: CONTENT_W, height: Math.max(80, room - 90) },
    { min: 36, max: 68, charWidth: 0.58, lineHeight: 1.1 },
  )
  return (
    <Page frames={frames} bleed topPad={topPad}>
      {img ? <Photo image={img} frames={frames} y={0} h={H} backdropOnly /> : null}
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
      <Fit
        maxHeight={room}
        style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: textTop }}
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
      </Fit>
    </Page>
  )
}

export function ImageFull({ frames, ctx, props, topPad }: ScreenProps) {
  const img = imageAt(ctx, props)
  const variant = prop<number>(props, 'variant', 0)
  if (!img) return <Page frames={frames} topPad={topPad} />
  const origins = ['50% 40%', '30% 50%', '70% 55%', '50% 65%']
  // Share cards and screenshots carry text to their edges: shown whole inside the safe box (phones
  // crop the sides, the action rail covers the right), never cropped full-bleed.
  const textual = img.kind === 'og' || img.kind === 'screenshot' || img.kind === 'figure'
  const padded = topPad > 0 || textual
  const top = CONTENT_TOP + topPad + 8
  return (
    <Page frames={frames} bleed topPad={topPad}>
      {padded ? (
        <>
          <Photo image={img} frames={frames} backdropOnly />
          <Photo
            image={img}
            frames={frames}
            x={SAFE.left}
            w={CONTENT_W}
            y={top}
            h={ZONE_BOTTOM - top}
            backdrop={false}
            maxUp={1.6}
            zoomTo={1.06}
            radius={20}
            keepInFrame
            contain={textual}
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
