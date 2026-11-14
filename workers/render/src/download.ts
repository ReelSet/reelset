import type { Logger } from '@reelset/core'

export const DOWNLOAD_PREFIX = '/dl/'

const REEL_KEY = /^reels\/[0-9a-f-]{36}\/[0-9a-zA-Z_-]{8,128}\.mp4$/

/** Turns an optional ?name= into a safe attachment filename. */
export function downloadName(raw: string | null): string {
  const base = (raw ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return `${base || 'reelset-reel'}.mp4`
}

/**
 * Media is public on media.reelset.app, but browsers ignore `download` on a cross-origin link, so
 * this serves the same R2 object with Content-Disposition: attachment.
 */
export async function handleDownload(
  request: Request,
  media: R2Bucket,
  log: Logger,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 })
  }
  let key: string
  try {
    key = decodeURIComponent(url.pathname.slice(DOWNLOAD_PREFIX.length))
  } catch {
    return new Response('not found', { status: 404 })
  }
  if (!REEL_KEY.test(key)) return new Response('not found', { status: 404 })
  const object = await media.get(key)
  if (!object) {
    log.warn({ key }, 'download for a missing reel')
    return new Response('not found', { status: 404 })
  }
  const name = downloadName(url.searchParams.get('name'))
  log.info({ key }, 'reel download')
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(object.size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    },
  })
}
