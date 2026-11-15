import { errorFields } from '@reelset/core'
import { previewByteLimit } from '@/lib/showcase'
import { routeLog } from '@/server/logger'
import { getShowcaseReels } from '@/server/showcase'

const FETCH_TIMEOUT_MS = 8000
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

async function totalBytes(url: string): Promise<number | null> {
  const res = await fetch(url, {
    headers: { range: 'bytes=0-0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const total = Number(res.headers.get('content-range')?.split('/')[1])
  return res.status === 206 && Number.isFinite(total) && total > 0 ? total : null
}

// Serves only the head of a showcase reel's MP4: a browser given the full URL buffers the whole file.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const log = routeLog('showcase-preview')
  const { id } = await ctx.params
  try {
    const reel = (await getShowcaseReels()).find((r) => r.id === id)
    if (!reel) return new Response('not found', { status: 404 })
    const total = await totalBytes(reel.videoUrl)
    if (total === null) return new Response('preview unavailable', { status: 502 })
    const limit = previewByteLimit(total, reel.durationMs)
    const upstream = await fetch(reel.videoUrl, {
      headers: { range: `bytes=0-${limit - 1}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (upstream.status !== 206 || !upstream.body) {
      return new Response('preview unavailable', { status: 502 })
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(limit),
        'cache-control': CACHE_CONTROL,
      },
    })
  } catch (err) {
    log.error({ ...errorFields(err), itemId: id }, 'showcase preview failed')
    return new Response('preview unavailable', { status: 502 })
  }
}
