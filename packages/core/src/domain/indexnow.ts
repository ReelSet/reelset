import { errorFields, type Logger } from '../lib/logger'

export const SITE_ORIGIN = 'https://reelset.app'

// IndexNow keys are public by design: the web app serves this one at INDEXNOW_KEY_PATH so Bing
// (and with it ChatGPT search and Copilot) can check that a submission really comes from us.
export const INDEXNOW_KEY = '8951554158ed87b739cebf364e4a7145'
export const INDEXNOW_KEY_PATH = '/indexnow-key.txt'
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
export const INDEXNOW_MAX_URLS = 10_000

const SLUG_MAX_CHARS = 60

// Same rules as apps/web/src/lib/reel-url.ts, which must stay free of @reelset/core (the proxy
// imports it). A web test keeps the two equal.
export function slugify(text: string, max = SLUG_MAX_CHARS): string {
  const base = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (base.length <= max) return base
  const cut = base.slice(0, max + 1)
  const boundary = cut.lastIndexOf('-')
  return (boundary > max / 2 ? cut.slice(0, boundary) : base.slice(0, max)).replace(/-+$/, '')
}

export function reelPath(item: { id: string; title?: string | null }): string {
  const slug = item.title ? slugify(item.title) : ''
  const short = item.id.replace(/-/g, '').slice(0, 8).toLowerCase()
  return `/r/${slug ? `${slug}-` : ''}${short}`
}

export function reelUrl(item: { id: string; title?: string | null }): string {
  return `${SITE_ORIGIN}${reelPath(item)}`
}

export type IndexNowResult = 'sent' | 'empty' | 'rejected' | 'failed'

/** Tells IndexNow engines these reelset.app URLs are new or changed. Never throws. */
export async function submitIndexNow(
  urls: string[],
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowResult> {
  const host = new URL(SITE_ORIGIN).host
  const list = [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === host
    } catch {
      return false
    }
  })
  const l = log.child({ indexnow: true, count: list.length })
  if (list.length === 0) {
    l.debug('indexnow skipped: no reelset urls')
    return 'empty'
  }
  if (list.length > INDEXNOW_MAX_URLS) l.warn('indexnow list cut to the protocol limit')
  try {
    const res = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_ORIGIN}${INDEXNOW_KEY_PATH}`,
        urlList: list.slice(0, INDEXNOW_MAX_URLS),
      }),
    })
    if (!res.ok) {
      l.warn({ status: res.status }, 'indexnow rejected the submission')
      return 'rejected'
    }
    l.info({ status: res.status }, 'indexnow submitted')
    return 'sent'
  } catch (err) {
    l.warn(errorFields(err), 'indexnow request failed')
    return 'failed'
  }
}
