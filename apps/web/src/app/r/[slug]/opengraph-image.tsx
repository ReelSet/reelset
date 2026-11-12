import { ImageResponse } from 'next/og'
import { parseReelParam } from '@/lib/reel-url'
import { hostOf } from '@/lib/seo/site'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { loadReelPage } from '@/server/seo-queries'

export const alt = 'Reelset reel'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TITLE_MAX_CHARS = 110

export default async function ReelOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const param = parseReelParam(slug)
  const reel = param
    ? await loadReelPage(getDb(), param, mediaBaseUrl(), routeLog('r/[slug]/og')).catch(() => null)
    : null
  const title = reel?.title ?? 'What developers are building, in 60-second reels.'
  const shown = title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title
  const byline = reel ? [hostOf(reel.canonicalUrl), ...reel.topics.slice(0, 2)].join('  ·  ') : ''

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: 'radial-gradient(circle at 85% 10%, #1f2a0a 0%, #09090b 55%)',
        color: '#f4f4f5',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
          padding: '72px 64px 64px 80px',
        }}
      >
        <div style={{ fontSize: 30, color: '#c8f751', letterSpacing: 2 }}>REELSET</div>
        <div style={{ fontSize: shown.length > 70 ? 50 : 62, fontWeight: 700, lineHeight: 1.1 }}>
          {shown}
        </div>
        <div style={{ fontSize: 26, color: '#a1a1aa' }}>{byline || 'reelset.app'}</div>
      </div>
      {reel?.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.posterUrl}
          alt=""
          width={354}
          height={630}
          style={{ width: 354, height: 630, objectFit: 'cover' }}
        />
      ) : null}
    </div>,
    size,
  )
}
