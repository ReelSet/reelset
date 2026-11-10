import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { Pop, Rise } from '../fx'
import { clipWords } from '../lib/table'
import { estimateLines, fitText, sentencesUpTo } from '../lib/text'
import { COLOR, CONTENT_TOP, CONTENT_W, FONT, H, LOW_TOP, SAFE, W, ZONE_BOTTOM } from '../theme'
import {
  Chip,
  Page,
  Photo,
  compact,
  grouped,
  imageAt,
  prop,
  useCount,
  type ScreenProps,
} from './ui'

const Meta = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 26,
      flexWrap: 'wrap',
      fontSize: 38,
      color: COLOR.muted,
      fontWeight: 600,
    }}
  >
    {children}
  </div>
)

/** Big number with its noun, for the "stats" look of a source card. */
function CountZoom({
  value,
  noun,
  color,
  delay = 0,
}: {
  value: number
  noun: string
  color: string
  delay?: number
}) {
  return (
    <Pop delay={delay}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 28 }}>
        <span
          style={{
            fontSize: 210,
            fontWeight: 900,
            letterSpacing: '-0.05em',
            lineHeight: 1,
            color,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {grouped(value)}
        </span>
        <span style={{ fontSize: 64, fontWeight: 800, color: COLOR.text }}>{noun}</span>
      </div>
    </Pop>
  )
}

/** A quoted line (top comment or post body) set large, attributed, with the source color rule. */
function QuoteCard({
  quote,
  by,
  color,
  title,
  room,
}: {
  quote: string
  by: string
  color: string
  title: string
  room: number
}) {
  const box = { width: CONTENT_W - 100, height: room - 330 }
  const opts = { min: 44, max: 76, charWidth: 0.54, lineHeight: 1.22 }
  let body = sentencesUpTo(quote, 200)
  for (
    let n = 200;
    n > 60 &&
    estimateLines(body, box.width, opts.min * opts.charWidth) * opts.min * opts.lineHeight >
      box.height;
    n -= 20
  )
    body = sentencesUpTo(quote, n)
  const size = fitText(body, box, opts)
  return (
    <>
      <div
        style={{
          fontSize: 36,
          color: COLOR.muted,
          fontWeight: 600,
          lineHeight: 1.25,
          maxHeight: 92,
          overflow: 'hidden',
        }}
      >
        {title}
      </div>
      <Pop delay={4} style={{ marginTop: 40 }}>
        <div
          style={{
            borderLeft: `10px solid ${color}`,
            background: 'rgba(255,255,255,0.06)',
            padding: '44px 44px 40px 48px',
            borderRadius: '0 36px 36px 0',
          }}
        >
          <div style={{ fontSize: 120, lineHeight: 0.5, color, fontWeight: 900, height: 52 }}>
            “
          </div>
          <div
            style={{ fontSize: size, lineHeight: 1.22, fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            {body}
          </div>
          <div style={{ fontSize: 36, color: COLOR.muted, fontWeight: 700, marginTop: 26 }}>
            — {by}
          </div>
        </div>
      </Pop>
    </>
  )
}

export function HNThread({ frames, ctx, props, topPad }: ScreenProps) {
  const hn = ctx.facts.hn
  const variant = prop<string>(props, 'variant', 'title')
  const comment = prop<string>(props, 'quote', hn?.topComment ?? '')
  const by = prop<string>(props, 'by', '') || (hn?.topComment ? 'top comment' : ctx.domain)
  const size = fitText(
    ctx.title,
    { width: CONTENT_W, height: 400 },
    { min: 52, max: 78, charWidth: 0.54, lineHeight: 1.12 },
  )
  const header = (
    <div
      style={{
        background: COLOR.hn,
        height: 124,
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${SAFE.left}px`,
        gap: 24,
      }}
    >
      <div
        style={{
          width: 66,
          height: 66,
          border: '4px solid #fff',
          color: '#fff',
          fontSize: 50,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        Y
      </div>
      <span style={{ fontSize: 48, fontWeight: 800, color: '#111' }}>Hacker News</span>
    </div>
  )
  const pad = { padding: `54px ${SAFE.right}px 0 ${SAFE.left}px` }
  return (
    <Page frames={frames} tint={COLOR.hn} topPad={topPad} bleed>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: CONTENT_TOP + topPad - 28,
          width: W,
          bottom: 0,
          background: '#16161a',
        }}
      >
        {header}
        {variant === 'comment' && comment ? (
          <div style={pad}>
            <QuoteCard
              quote={comment}
              by={by}
              color={COLOR.hn}
              title={ctx.title}
              room={ZONE_BOTTOM - CONTENT_TOP - topPad - 150}
            />
          </div>
        ) : variant === 'stats' && (hn?.points !== undefined || hn?.comments !== undefined) ? (
          <div style={pad}>
            <div
              style={{
                fontSize: 38,
                color: COLOR.muted,
                fontWeight: 600,
                lineHeight: 1.25,
                maxHeight: 96,
                overflow: 'hidden',
              }}
            >
              {ctx.title}
            </div>
            <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 36 }}>
              {hn?.points !== undefined ? (
                <CountZoom value={hn.points} noun="points" color={COLOR.hn} />
              ) : null}
              {hn?.comments !== undefined ? (
                <CountZoom value={hn.comments} noun="comments" color={COLOR.text} delay={6} />
              ) : null}
            </div>
            {hn?.author ? (
              <div style={{ marginTop: 40, fontSize: 40, color: COLOR.muted, fontWeight: 600 }}>
                posted by {hn.author}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={pad}>
            <Rise>
              <div style={{ display: 'flex', gap: 28 }}>
                <div style={{ color: COLOR.hn, fontSize: 64, lineHeight: 1, paddingTop: 6 }}>▲</div>
                <div
                  style={{
                    fontSize: size,
                    fontWeight: 700,
                    lineHeight: 1.12,
                    letterSpacing: '-0.025em',
                  }}
                >
                  {ctx.title}
                </div>
              </div>
            </Rise>
            <div style={{ marginTop: 26, paddingLeft: 92 }}>
              <Meta>
                <span>{ctx.domain}</span>
                {hn?.points !== undefined ? (
                  <b style={{ color: COLOR.hn }}>{grouped(hn.points)} points</b>
                ) : null}
              </Meta>
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}

export function RedditPost({ frames, ctx, props, topPad }: ScreenProps) {
  const rd = ctx.facts.reddit
  const variant = prop<string>(props, 'variant', 'title')
  const quote = prop<string>(props, 'quote', rd?.topComment ?? rd?.text ?? '')
  const by = prop<string>(props, 'by', '') || (rd?.author ? `u/${rd.author}` : 'post')
  const size = fitText(
    ctx.title,
    { width: CONTENT_W - 40, height: 460 },
    { min: 52, max: 80, charWidth: 0.54, lineHeight: 1.14 },
  )
  const sub = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        fontSize: 38,
        color: COLOR.muted,
        fontWeight: 600,
      }}
    >
      <div
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          background: COLOR.reddit,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: 34,
        }}
      >
        r/
      </div>
      <span style={{ color: COLOR.text, fontWeight: 800 }}>
        {rd?.subreddit ? `r/${rd.subreddit}` : ctx.domain}
      </span>
      {rd?.author ? <span>u/{rd.author}</span> : null}
    </div>
  )
  if (variant === 'comment' && quote) {
    return (
      <Page frames={frames} tint={COLOR.reddit} topPad={topPad}>
        {sub}
        <div style={{ marginTop: 36 }}>
          <QuoteCard
            quote={quote}
            by={by}
            color={COLOR.reddit}
            title={ctx.title}
            room={ZONE_BOTTOM - CONTENT_TOP - topPad - 150}
          />
        </div>
      </Page>
    )
  }
  if (variant === 'stats' && (rd?.upvotes !== undefined || rd?.comments !== undefined)) {
    return (
      <Page frames={frames} tint={COLOR.reddit} topPad={topPad}>
        {sub}
        <div
          style={{
            fontSize: 40,
            color: COLOR.muted,
            fontWeight: 600,
            marginTop: 30,
            lineHeight: 1.25,
          }}
        >
          {ctx.title}
        </div>
        <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 36 }}>
          {rd?.upvotes !== undefined ? (
            <CountZoom value={rd.upvotes} noun="upvotes" color={COLOR.reddit} />
          ) : null}
          {rd?.comments !== undefined ? (
            <CountZoom value={rd.comments} noun="comments" color={COLOR.text} delay={6} />
          ) : null}
        </div>
      </Page>
    )
  }
  return (
    <Page frames={frames} tint={COLOR.reddit} topPad={topPad}>
      <Pop>
        <div
          style={{
            background: '#1a1a1e',
            borderRadius: 44,
            padding: '48px 44px',
            border: `2px solid ${COLOR.line}`,
          }}
        >
          {sub}
          <div
            style={{
              fontSize: size,
              fontWeight: 800,
              lineHeight: 1.14,
              letterSpacing: '-0.03em',
              marginTop: 36,
            }}
          >
            {ctx.title}
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 44, flexWrap: 'wrap' }}>
            <Chip size={40} bg="rgba(255,255,255,0.09)">
              <span style={{ color: COLOR.reddit }}>▲</span>
              {rd?.upvotes !== undefined ? grouped(rd.upvotes) : 'Upvote'}
              <span style={{ color: COLOR.dim }}>▼</span>
            </Chip>
            {rd?.comments !== undefined ? (
              <Chip
                size={40}
                bg="rgba(255,255,255,0.09)"
              >{`${grouped(rd.comments)} comments`}</Chip>
            ) : null}
          </div>
        </div>
      </Pop>
    </Page>
  )
}

export function YouTubePlayer({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const yt = ctx.facts.youtube
  const img = imageAt(ctx, props)
  const top = CONTENT_TOP + topPad - 28
  const playerH = 608
  const progress = interpolate(frame, [0, frames], [0.08, 0.34], { extrapolateRight: 'clamp' })
  const size = fitText(
    ctx.title,
    { width: CONTENT_W, height: 230 },
    { min: 44, max: 60, charWidth: 0.56, lineHeight: 1.18 },
  )
  return (
    <Page frames={frames} tint={COLOR.youtube} topPad={topPad} bleed>
      {img ? (
        <Photo image={img} frames={frames} x={0} y={0} w={W} h={H} zoomTo={1} backdropOnly />
      ) : null}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,9,11,0.72)' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top,
          width: W,
          height: playerH,
          background: '#000',
          overflow: 'hidden',
        }}
      >
        {img ? (
          <Img
            src={staticFile(img.src)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${1 + 0.05 * (frame / Math.max(1, frames))})`,
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `linear-gradient(135deg, #2a0a10, #0c0c10)`,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: 75,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="70" height="70" viewBox="0 0 24 24">
              <path d="M7 4.5v15l13-7.5z" fill="#fff" />
            </svg>
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 10,
            background: 'rgba(255,255,255,0.25)',
          }}
        >
          <div style={{ width: `${progress * 100}%`, height: '100%', background: COLOR.youtube }} />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: SAFE.left,
          right: SAFE.right,
          top: top + playerH + 36,
        }}
      >
        <Rise>
          <div
            style={{ fontSize: size, fontWeight: 800, lineHeight: 1.18, letterSpacing: '-0.025em' }}
          >
            {ctx.title}
          </div>
        </Rise>
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: LOW_TOP + 10 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            fontSize: 38,
            color: COLOR.muted,
            fontWeight: 600,
          }}
        >
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              background: COLOR.youtube,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 900,
              fontSize: 40,
            }}
          >
            {(yt?.channel ?? ctx.sourceLabel).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div style={{ color: COLOR.text, fontWeight: 800 }}>
              {yt?.channel ?? ctx.sourceLabel}
            </div>
            {yt?.views !== undefined ? <div>{compact(yt.views)} views</div> : null}
          </div>
        </div>
        <div
          style={{
            marginTop: 34,
            background: 'rgba(255,255,255,0.07)',
            borderRadius: 28,
            padding: '26px 32px',
            fontSize: 36,
            lineHeight: 1.3,
            color: '#d4d4d8',
            maxHeight: 190,
            overflow: 'hidden',
          }}
        >
          {ctx.hook}
        </div>
      </div>
    </Page>
  )
}
