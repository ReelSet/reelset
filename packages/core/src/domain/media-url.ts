/**
 * Bumped when reel posters are rewritten in place (2: re-taken at the sharpest hook frame on
 * 2026-11-16). The CDN, browsers and the image optimizer cache by URL, so the query fetches the new file.
 */
export const POSTER_CACHE_VERSION = 2

const REEL_POSTER_KEY = /^reels\/[^/]+\/[^/]+\.jpg$/

/** Public URL for an R2 media key; reel posters carry the cache version. */
export function mediaKeyUrl(base: string, key: string): string {
  const clean = key.replace(/^\/+/, '')
  const url = `${base.replace(/\/+$/, '')}/${clean}`
  return REEL_POSTER_KEY.test(clean) ? `${url}?v=${POSTER_CACHE_VERSION}` : url
}
