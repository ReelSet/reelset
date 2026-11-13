// Client-safe: shared by the feed (address bar), links and the server pages.

export const SHORT_ID_LENGTH = 8
const SLUG_MAX_CHARS = 60
const TOPIC_SLUG_MAX_CHARS = 40
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REEL_PARAM_RE = /^(?:([a-z0-9-]*)-)?([0-9a-f]{8})$/

/** Lowercase ASCII words joined by dashes, cut at a word boundary. */
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

/** First 8 hex chars of the item uuid: the stable part of a reel URL. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, SHORT_ID_LENGTH).toLowerCase()
}

/** Canonical reel path, `/r/<title-slug>-<shortid>`; without a title it redirects to that. */
export function reelPath(item: { id: string; title?: string | null }): string {
  const slug = item.title ? slugify(item.title) : ''
  return `/r/${slug ? `${slug}-` : ''}${shortId(item.id)}`
}

/** Reel path that keeps the topic feed it was opened from, so scrolling stays in that topic. */
export function reelHref(
  item: { id: string; title?: string | null },
  topic?: string | null,
): string {
  const path = reelPath(item)
  return topic ? `${path}?topic=${encodeURIComponent(topic)}` : path
}

export type ReelParam = { shortId: string; slug: string; id: string | null }

/** Reads `/r/<param>`: `slug-shortid`, a bare short id, or a full uuid (old links). */
export function parseReelParam(raw: string): ReelParam | null {
  let param: string
  try {
    param = decodeURIComponent(raw).trim().toLowerCase()
  } catch {
    return null
  }
  if (UUID_RE.test(param)) return { shortId: shortId(param), slug: '', id: param }
  const match = REEL_PARAM_RE.exec(param)
  if (!match?.[2]) return null
  return { shortId: match[2], slug: match[1] ?? '', id: null }
}

/** Inclusive uuid bounds for a short id, so the lookup is a primary-key range scan. */
export function shortIdRange(short: string): [string, string] {
  return [`${short}-0000-0000-0000-000000000000`, `${short}-ffff-ffff-ffff-ffffffffffff`]
}

export function topicSlug(topic: string): string {
  return slugify(topic, TOPIC_SLUG_MAX_CHARS)
}

export function topicPath(topic: string): string {
  return `/t/${topicSlug(topic)}`
}

/** Old share links were `/?reel=<uuid>`; they move to the reel page with a permanent redirect. */
export function legacyReelRedirect(pathname: string, reelParam: string | null): string | null {
  if (pathname !== '/' || !reelParam) return null
  const param = parseReelParam(reelParam)
  return param ? `/r/${param.shortId}` : null
}
