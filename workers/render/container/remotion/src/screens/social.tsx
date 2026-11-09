import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { Pop, Rise } from '../fx'
import { fitText } from '../lib/text'
import { COLOR, CONTENT_TOP, CONTENT_W, FONT, H, LOW_TOP, SAFE, W } from '../theme'
import { Chip, Page, Photo, compact, grouped, imageAt, prop, useCount, type ScreenProps } from './ui'

const Meta = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap', fontSize: 38, color: COLOR.muted, fontWeight: 600 }}>{children}</div>
)

export function HNThread({ frames, ctx, props, topPad }: ScreenProps) {
  const hn = ctx.facts.hn
  const count = useCount(frames, 0.5)
  const comment = prop<string>(props, 'quote', hn?.topComment ?? '')
  const by = prop<string>(props, 'by', '')
  const size = fitText(ctx.title, { width: CONTENT_W, height: 400 }, { min: 52, max: 78, charWidth: 0.54, lineHeight: 1.12 })
  return (
    <Page frames={frames} tint={COLOR.hn} topPad={topPad} bleed>
      <div style={{ position: 'absolute', left: 0, top: CONTENT_TOP + topPad - 28, width: W, bottom: 0, background: '#16161a' }}>
        <div style={{ background: COLOR.hn, height: 124, display: 'flex', alignItems: 'center', padding: `0 ${SAFE.left}px`, gap: 24 }}>
          <div style={{ width: 66, height: 66, border: '4px solid #fff', color: '#fff', fontSize: 50, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Y</div>
          <span style={{ fontSize: 48, fontWeight: 800, color: '#111' }}>Hacker News</span>
        </div>
        <div style={{ padding: `54px ${SAFE.right}px 0 ${SAFE.left}px` }}>
          <Rise>
            <div style={{ display: 'flex', gap: 28 }}>
              <div style={{ color: COLOR.hn, fontSize: 64, lineHeight: 1, paddingTop: 6 }}>▲</div>
              <div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.025em' }}>{ctx.title}</div>
            </div>
          </Rise>
          <div style={{ marginTop: 26, paddingLeft: 92 }}>
            <Meta>
              <span>{ctx.domain}</span>
            </Meta>
            {hn?.points !== undefined || hn?.comments !== undefined ? (
              <div style={{ marginTop: 18 }}>
                <Meta>
                  {hn?.points !== undefined ? <b style={{ color: COLOR.hn, fontSize: 46 }}>{grouped(hn.points * count)} points</b> : null}
                  {hn?.comments !== undefined ? <span>{grouped(hn.comments * count)} comments</span> : null}
                  {hn?.author ? <span>by {hn.author}</span> : null}
                </Meta>
              </div>
            ) : null}
          </div>
          {comment ? (
            <Pop delay={10} style={{ marginTop: 70 }}>
              <div style={{ borderLeft: `8px solid ${COLOR.hn}`, background: 'rgba(255,255,255,0.05)', padding: '34px 38px', borderRadius: '0 28px 28px 0' }}>
                <div style={{ fontSize: 34, color: COLOR.muted, fontWeight: 700, marginBottom: 14 }}>{by || 'top comment'}</div>
                <div style={{ fontSize: 44, lineHeight: 1.3, fontWeight: 500, maxHeight: 400, overflow: 'hidden' }}>{comment.length > 260 ? `${comment.slice(0, 257)}...` : comment}</div>
              </div>
            </Pop>
          ) : null}
        </div>
      </div>
    </Page>
  )
}

export function RedditPost({ frames, ctx, topPad }: ScreenProps) {
  const rd = ctx.facts.reddit
  const count = useCount(frames, 0.5)
  const size = fitText(ctx.title, { width: CONTENT_W - 40, height: 460 }, { min: 52, max: 80, charWidth: 0.54, lineHeight: 1.14 })
  return (
    <Page frames={frames} tint={COLOR.reddit} topPad={topPad}>
      <Pop>
        <div style={{ background: '#1a1a1e', borderRadius: 44, padding: '48px 44px', border: `2px solid ${COLOR.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 38, color: COLOR.muted, fontWeight: 600 }}>
            <div style={{ width: 76, height: 76, borderRadius: 38, background: COLOR.reddit, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 34 }}>r/</div>
            <span style={{ color: COLOR.text, fontWeight: 800 }}>{rd?.subreddit ? `r/${rd.subreddit}` : ctx.domain}</span>
            {rd?.author ? <span>u/{rd.author}</span> : null}
          </div>
          <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.14, letterSpacing: '-0.03em', marginTop: 36 }}>{ctx.title}</div>
          <div style={{ display: 'flex', gap: 22, marginTop: 44, flexWrap: 'wrap' }}>
            <Chip size={40} bg="rgba(255,255,255,0.09)">
              <span style={{ color: COLOR.reddit }}>▲</span>
              {rd?.upvotes !== undefined ? grouped(rd.upvotes * count) : 'Upvote'}
              <span style={{ color: COLOR.dim }}>▼</span>
            </Chip>
            <Chip size={40} bg="rgba(255,255,255,0.09)">
              {rd?.comments !== undefined ? `${grouped(rd.comments * count)} comments` : 'Comments'}
            </Chip>
          </div>
        </div>
      </Pop>
      <div style={{ position: 'absolute', left: -SAFE.left, width: W, top: LOW_TOP - CONTENT_TOP - topPad, height: H, background: '#121215', borderTop: `2px solid ${COLOR.line}`, padding: `36px ${SAFE.right}px 0 ${SAFE.left}px`, fontSize: 38, color: COLOR.muted, fontWeight: 600 }}>
        Top comments
      </div>
    </Page>
  )
}

export function YouTubePlayer({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const yt = ctx.facts.youtube
  const count = useCount(frames, 0.5)
  const img = imageAt(ctx, props)
  const top = CONTENT_TOP + topPad - 28
  const playerH = 608
  const progress = interpolate(frame, [0, frames], [0.08, 0.34], { extrapolateRight: 'clamp' })
  const size = fitText(ctx.title, { width: CONTENT_W, height: 230 }, { min: 44, max: 60, charWidth: 0.56, lineHeight: 1.18 })
  return (
    <Page frames={frames} tint={COLOR.youtube} topPad={topPad} bleed>
      {img ? <Photo image={img} frames={frames} x={0} y={0} w={W} h={H} zoomTo={1} maxUp={0.01} /> : null}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,9,11,0.72)' }} />
      <div style={{ position: 'absolute', left: 0, top, width: W, height: playerH, background: '#000', overflow: 'hidden' }}>
        {img ? (
          <Img src={staticFile(img.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1 + 0.05 * (frame / Math.max(1, frames))})` }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, #2a0a10, #0c0c10)` }} />
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 150, height: 150, borderRadius: 75, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="70" height="70" viewBox="0 0 24 24">
              <path d="M7 4.5v15l13-7.5z" fill="#fff" />
            </svg>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, background: 'rgba(255,255,255,0.25)' }}>
          <div style={{ width: `${progress * 100}%`, height: '100%', background: COLOR.youtube }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: top + playerH + 36 }}>
        <Rise>
          <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.18, letterSpacing: '-0.025em' }}>{ctx.title}</div>
        </Rise>
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: LOW_TOP + 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24,  fontSize: 38, color: COLOR.muted, fontWeight: 600 }}>
          <div style={{ width: 84, height: 84, borderRadius: 42, background: COLOR.youtube, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 40 }}>
            {(yt?.channel ?? ctx.sourceLabel).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div style={{ color: COLOR.text, fontWeight: 800 }}>{yt?.channel ?? ctx.sourceLabel}</div>
            {yt?.views !== undefined ? <div>{compact(Math.round(yt.views * count))} views</div> : null}
          </div>
        </div>
        <div style={{ marginTop: 34, background: 'rgba(255,255,255,0.07)', borderRadius: 28, padding: '26px 32px', fontSize: 36, lineHeight: 1.3, color: '#d4d4d8', maxHeight: 190, overflow: 'hidden' }}>
          {ctx.hook}
        </div>
      </div>
    </Page>
  )
}
