import {
  MAX_ITEM_IMAGES,
  errorFields,
  parseItemImages,
  type ItemImage,
  type ItemImageKind,
  type Logger,
  type ParsedPaper,
} from '@reelset/core'
import { ARCTIC_BASE_URL, USER_AGENT } from './config'
import { decodeEntities } from './html'
import { mainContentHtml } from './article'

export const IMAGE_FETCH_TIMEOUT_MS = 8000
const PAGE_MAX_CHARS = 600_000
const MIN_WIDTH = 200
const MIN_HEIGHT = 120
const MIN_INLINE_WIDTH = 320
const MAX_INLINE = 3
const MAX_FIGURES = 4

const JUNK_HOSTS =
  /(?:^|\.)(?:shields\.io|badge\.fury\.io|badgen\.net|travis-ci\.(?:org|com)|codecov\.io|circleci\.com|coveralls\.io|gravatar\.com|doubleclick\.net|googletagmanager\.com|facebook\.com|scorecardresearch\.com|pixel\.wp\.com|stats\.wp\.com|api\.star-history\.com|visitor-badge|hits\.seeyoufarm\.com|komarev\.com|capsule-render)/i
const JUNK_PATH =
  /(?:sprite|logo|favicon|emoji|spacer|pixel|tracking|1x1|blank\.|placeholder|loading|badge|\/icons?\/|[_-]icon[._-]|gravatar|avatar|banner-ad|\/ads?\/|wp-emoji|button|\/static\/base\/|\/funders\/)/i
const SKIP_EXT = /\.(?:svg|ico|cur|bmp|tiff?)(?:[?#]|$)/i

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function normalizeImageUrl(raw: string, base: string): string | null {
  const trimmed = decodeEntities(raw.trim())
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null
  const url = parseUrl(trimmed.startsWith('//') ? `https:${trimmed}` : new URL(trimmed, base).href)
  if (!url) return null
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  const out = url.href
  return out.length <= 2048 ? out : null
}

export function isJunkImage(url: string, width?: number, height?: number): boolean {
  const parsed = parseUrl(url)
  if (!parsed) return true
  if (SKIP_EXT.test(parsed.pathname)) return true
  if (JUNK_HOSTS.test(parsed.hostname)) return true
  if (JUNK_PATH.test(parsed.pathname)) return true
  if (width !== undefined && width < MIN_WIDTH) return true
  if (height !== undefined && height < MIN_HEIGHT) return true
  if (width !== undefined && height !== undefined && (width > height * 6 || height > width * 4))
    return true
  return false
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 && n < 20000 ? n : undefined
}

function clip(text: string, max: number): string | undefined {
  const t = decodeEntities(text).replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : undefined
}

function image(
  url: string,
  kind: ItemImageKind,
  width?: number,
  height?: number,
  alt?: string,
): ItemImage {
  const out: ItemImage = { url, kind }
  if (width) out.width = width
  if (height) out.height = height
  if (alt) out.alt = alt
  return out
}

/** og:image / twitter:image from page metadata. */
export function extractMetaImages(html: string, baseUrl: string): ItemImage[] {
  const metas = [...html.slice(0, 200_000).matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]))
  const get = (...names: string[]) => {
    for (const name of names) {
      const hit = metas.find(
        (a) => (a.property ?? a.name ?? '').toLowerCase() === name && a.content,
      )
      if (hit) return hit.content!
    }
    return undefined
  }
  const raw = get('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src')
  if (!raw) return []
  const url = normalizeImageUrl(raw, baseUrl)
  if (!url) return []
  const width = toInt(get('og:image:width'))
  const height = toInt(get('og:image:height'))
  if (isJunkImage(url, width, height)) return []
  return [
    image(url, 'og', width, height, clip(get('og:image:alt', 'twitter:image:alt') ?? '', 300)),
  ]
}

function largestSrcset(srcset: string): string | undefined {
  let best: { url: string; w: number } | undefined
  for (const part of srcset.split(',')) {
    const [url, size] = part.trim().split(/\s+/)
    if (!url) continue
    const w = size?.endsWith('w') ? Number.parseInt(size, 10) : 1
    if (!best || w > best.w) best = { url, w }
  }
  return best?.url
}

/** Large images from the main article body, figures first. */
export function extractInlineImages(
  html: string,
  baseUrl: string,
  kind: ItemImageKind = 'figure',
  max = MAX_INLINE,
): ItemImage[] {
  const body = mainContentHtml(html)
  const out: ItemImage[] = []
  const seen = new Set<string>()
  const push = (tag: string, caption?: string) => {
    const a = attrs(tag)
    const raw =
      (a.srcset ? largestSrcset(a.srcset) : undefined) ??
      a['data-src'] ??
      a['data-lazy-src'] ??
      (a['data-srcset'] ? largestSrcset(a['data-srcset']) : undefined) ??
      a.src
    if (!raw) return
    const url = normalizeImageUrl(raw, baseUrl)
    if (!url || seen.has(url)) return
    const width = toInt(a.width)
    const height = toInt(a.height)
    if (isJunkImage(url, width, height)) return
    if (width !== undefined && width < MIN_INLINE_WIDTH) return
    if (/^(?:true|presentation)$/i.test(a['aria-hidden'] ?? a.role ?? '')) return
    seen.add(url)
    out.push(image(url, kind, width, height, clip(caption || a.alt || '', 300)))
  }

  for (const fig of body.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)) {
    const img = /<img\b[^>]*>/i.exec(fig[0])
    const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(fig[0])?.[1]
    if (img) push(img[0], cap ? cap.replace(/<[^>]*>/g, ' ') : undefined)
  }
  if (out.length < max) for (const img of body.matchAll(/<img\b[^>]*>/gi)) push(img[0])
  return out.slice(0, max)
}

/** arXiv HTML (LaTeXML) figures: caption text comes from <figcaption>, not the "Refer to caption" alt. */
export function extractArxivFigures(html: string, baseUrl: string): ItemImage[] {
  const out: ItemImage[] = []
  const seen = new Set<string>()
  for (const fig of html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)) {
    if (/ltx_table/.test(fig[0].slice(0, 200))) continue
    const img = /<img\b[^>]*>/i.exec(fig[0])
    if (!img) continue
    const a = attrs(img[0])
    if (!a.src) continue
    const url = normalizeImageUrl(a.src, baseUrl)
    if (!url || seen.has(url) || SKIP_EXT.test(url)) continue
    const width = toInt(a.width)
    const height = toInt(a.height)
    if ((width !== undefined && width < 280) || (height !== undefined && height < 120)) continue
    const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(fig[0])?.[1]
    seen.add(url)
    out.push(image(url, 'figure', width, height, clip(cap?.replace(/<[^>]*>/g, ' ') ?? '', 300)))
    if (out.length >= MAX_FIGURES) break
  }
  return out
}

/** Figures from a parsed paper as item images: original-resolution ones first when there are enough. */
export function paperFigureImages(paper: ParsedPaper, max = 5): ItemImage[] {
  const usable = paper.figures.filter((f) => f.url.startsWith('https://') && f.url.length <= 2048)
  const hires = usable.filter((f) => f.hires)
  return (hires.length >= 2 ? hires : usable)
    .slice(0, max)
    .map((f) =>
      image(
        f.url,
        'figure',
        f.width ?? undefined,
        f.height ?? undefined,
        clip([f.label, f.caption].filter(Boolean).join(': '), 300),
      ),
    )
}

/** Images referenced in a README (markdown or inline HTML), absolute raw URLs, badges skipped. */
export function extractReadmeImages(readme: string, owner: string, repo: string): ItemImage[] {
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`
  const out: ItemImage[] = []
  const seen = new Set<string>()
  const push = (raw: string, alt: string | undefined, w?: number, h?: number) => {
    let src = raw.trim().replace(/^<|>$/g, '').split(/\s+/)[0] ?? ''
    if (!src || src.startsWith('#')) return
    if (!/^(?:https?:)?\/\//i.test(src)) src = src.replace(/^\.?\//, '')
    const url = normalizeImageUrl(src, base)
    if (!url || seen.has(url)) return
    const blob = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+)$/.exec(url)
    const final = blob
      ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]!.split('?')[0]}`
      : url
    if (isJunkImage(final, w, h)) return
    seen.add(url)
    out.push(image(final, 'figure', w, h, clip(alt ?? '', 300)))
  }
  const text = readme.replace(/<!--[\s\S]*?-->/g, '')
  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    push(m[2]!, m[1])
  }
  for (const m of text.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0])
    if (a.src) push(a.src, a.alt, toInt(a.width), toInt(a.height))
  }
  return out
}

export function youtubeThumbnail(videoId: string, maxres: boolean): ItemImage {
  return maxres
    ? image(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, 'thumbnail', 1280, 720)
    : image(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, 'thumbnail', 480, 360)
}

export function githubSocialPreview(owner: string, repo: string): ItemImage {
  return image(`https://opengraph.githubassets.com/1/${owner}/${repo}`, 'og', 1200, 600)
}

const KIND_ORDER: Record<ItemImageKind, number> = {
  og: 0,
  thumbnail: 1,
  screenshot: 2,
  figure: 3,
  avatar: 4,
}

/** Dedupe by URL, hero kinds first, capped. Order inside a kind is preserved. */
export function mergeImages(lists: ItemImage[][], max = MAX_ITEM_IMAGES): ItemImage[] {
  const seen = new Set<string>()
  const flat: ItemImage[] = []
  for (const img of lists.flat()) {
    if (seen.has(img.url)) continue
    seen.add(img.url)
    flat.push(img)
  }
  const ordered = flat
    .map((img, i) => ({ img, i }))
    .sort((a, b) => KIND_ORDER[a.img.kind] - KIND_ORDER[b.img.kind] || a.i - b.i)
    .map((x) => x.img)
  return parseItemImages(ordered).slice(0, max)
}

export type PageFetch = { text: string; url: string }

export type ImageFetchers = {
  page: (url: string) => Promise<PageFetch | null>
  head: (url: string) => Promise<boolean>
  json: (url: string) => Promise<unknown>
}

export function defaultFetchers(githubToken?: string): ImageFetchers {
  const get = async (url: string, accept: string, method = 'GET') => {
    const headers: Record<string, string> = { accept, 'user-agent': `${USER_AGENT} Mozilla/5.0` }
    if (githubToken && new URL(url).hostname === 'api.github.com')
      headers.authorization = `Bearer ${githubToken}`
    return fetch(url, {
      method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
  }
  return {
    async page(url) {
      const res = await get(url, 'text/html,application/xhtml+xml,text/plain,*/*;q=0.5')
      if (!res.ok) return null
      const text = (await res.text()).slice(0, PAGE_MAX_CHARS)
      return { text, url: res.url || url }
    },
    async head(url) {
      const res = await get(url, 'image/*', 'HEAD')
      return res.ok && Number(res.headers.get('content-length') ?? '9999') > 4000
    },
    async json(url) {
      const res = await get(url, 'application/json')
      return res.ok ? res.json() : null
    },
  }
}

export type CaptureInput = {
  canonicalKey: string
  canonicalUrl: string
  mentionUrls: string[]
  paper?: ParsedPaper | null
}

type Deps = { fetchers?: ImageFetchers; log: Logger; githubToken?: string }

async function safe<T>(log: Logger, what: string, fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    log.warn({ what, ...errorFields(err) }, 'image capture step failed')
    return empty
  }
}

async function articleImages(url: string, f: ImageFetchers, log: Logger): Promise<ItemImage[]> {
  const page = await safe(log, 'article page', () => f.page(url), null)
  if (!page) return []
  return mergeImages([
    extractMetaImages(page.text, page.url),
    extractInlineImages(page.text, page.url, 'figure'),
  ])
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i
const REDDIT_MAX_IMAGES = 4
const REDDIT_MEDIA_EXT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const DIRECT_IMAGE_HOST = /^https:\/\/(?:i\.redd\.it|i\.imgur\.com)\//
const PREVIEW_HOST = /^https:\/\/(?:external-)?preview\.redd\.it\//

type RedditMedia = {
  e?: unknown
  m?: unknown
  status?: unknown
  s?: { x?: unknown; y?: unknown; u?: unknown }
}
type RedditPreviewSource = { url?: unknown; width?: unknown; height?: unknown }

const num = (v: unknown) => (typeof v === 'number' && v > 0 && v < 20000 ? v : undefined)

// i.redd.it serves the upload's own extension (.jpg and .jpeg both occur for image/jpeg), which the
// signed preview URL keeps; the mime type is only a fallback.
function redditMediaExt(id: string, m: RedditMedia): string | undefined {
  const preview = typeof m.s?.u === 'string' ? m.s.u : ''
  const fromPreview = new RegExp(`/${id}\\.(jpe?g|png|webp)(?:[?#]|$)`, 'i').exec(preview)?.[1]
  if (fromPreview) return fromPreview.toLowerCase()
  return typeof m.m === 'string' ? REDDIT_MEDIA_EXT[m.m] : undefined
}

/**
 * A Reddit post's own pictures: gallery items and images embedded in the text (media_metadata,
 * rebuilt as i.redd.it originals), a direct image link, or else the preview frame of a video or
 * link post. Animated images are skipped.
 */
export function redditPostImages(post: unknown): ItemImage[] {
  if (!post || typeof post !== 'object') return []
  const p = post as {
    url?: unknown
    media_metadata?: unknown
    gallery_data?: { items?: { media_id?: unknown }[] } | null
    preview?: { images?: { source?: RedditPreviewSource }[] } | null
  }
  const out: ItemImage[] = []
  const meta =
    p.media_metadata && typeof p.media_metadata === 'object'
      ? (p.media_metadata as Record<string, RedditMedia>)
      : {}
  const galleryIds = (p.gallery_data?.items ?? [])
    .map((i) => i.media_id)
    .filter((id): id is string => typeof id === 'string')
  const ids = galleryIds.length > 0 ? galleryIds : Object.keys(meta)
  for (const id of ids) {
    const m = meta[id]
    if (!m || m.e !== 'Image' || (m.status !== undefined && m.status !== 'valid')) continue
    if (!/^[a-z0-9]+$/i.test(id)) continue
    const ext = redditMediaExt(id, m)
    if (!ext) continue
    out.push(image(`https://i.redd.it/${id}.${ext}`, 'figure', num(m.s?.x), num(m.s?.y)))
    if (out.length >= REDDIT_MAX_IMAGES) return out
  }
  if (out.length > 0) return out

  const source = p.preview?.images?.[0]?.source
  const width = num(source?.width)
  const height = num(source?.height)
  const direct =
    typeof p.url === 'string' ? normalizeImageUrl(p.url, 'https://www.reddit.com/') : null
  if (direct && DIRECT_IMAGE_HOST.test(direct) && IMAGE_EXT.test(direct)) {
    return [image(direct, 'figure', width, height)]
  }
  const preview =
    typeof source?.url === 'string'
      ? normalizeImageUrl(source.url, 'https://www.reddit.com/')
      : null
  if (preview && PREVIEW_HOST.test(preview)) return [image(preview, 'thumbnail', width, height)]
  return []
}

/** Real source imagery for one item, best effort. Never throws. Direct fetches only. */
export async function captureItemImages(input: CaptureInput, deps: Deps): Promise<ItemImage[]> {
  const f = deps.fetchers ?? defaultFetchers(deps.githubToken)
  const log = deps.log.child({ mod: 'images', key: input.canonicalKey.slice(0, 80) })
  const key = input.canonicalKey
  let out: ItemImage[] = []

  if (key.startsWith('youtube:')) {
    const id = key.slice('youtube:'.length)
    const maxres = await safe(
      log,
      'ytimg head',
      () => f.head(youtubeThumbnail(id, true).url),
      false,
    )
    out = [youtubeThumbnail(id, maxres)]
  } else if (key.startsWith('github:')) {
    const [owner, repo] = key.slice('github:'.length).split('/')
    if (owner && repo) {
      const pageImgs = await safe(
        log,
        'github page',
        async () => {
          const page = await f.page(`https://github.com/${owner}/${repo}`)
          return page ? extractMetaImages(page.text, page.url) : []
        },
        [],
      )
      const social = pageImgs.length > 0 ? pageImgs : [githubSocialPreview(owner, repo)]
      const readme = await safe(
        log,
        'github readme',
        async () => {
          const page = await f.page(
            `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
          )
          return page ? extractReadmeImages(page.text, owner, repo).slice(0, 3) : []
        },
        [],
      )
      out = mergeImages([social, readme])
    }
  } else if (key.startsWith('arxiv:')) {
    const id = key.slice('arxiv:'.length)
    const hf = await safe(
      log,
      'hf paper',
      async () => {
        const page = await f.page(`https://huggingface.co/papers/${id}`)
        return page
          ? extractMetaImages(page.text, page.url).map((i) => ({
              ...i,
              kind: 'thumbnail' as const,
            }))
          : []
      },
      [],
    )
    const parsedFigures = input.paper ? paperFigureImages(input.paper) : []
    const figures =
      parsedFigures.length > 0
        ? parsedFigures
        : await safe(
            log,
            'arxiv html',
            async () => {
              const page = await f.page(`https://arxiv.org/html/${id}`)
              return page ? extractArxivFigures(page.text, page.url).slice(0, 4) : []
            },
            [],
          )
    out = mergeImages([hf, figures])
  } else if (key.startsWith('reddit:')) {
    const id = key.slice('reddit:'.length)
    const data = await safe(
      log,
      'reddit post',
      () => f.json(`${ARCTIC_BASE_URL}/api/posts/ids?ids=${encodeURIComponent(id)}`),
      null,
    )
    const post = (data as { data?: unknown[] } | null)?.data?.[0]
    out = redditPostImages(post)
    log.info({ post: id, images: out.length }, 'reddit post images')
  } else if (key.startsWith('hn:')) {
    out = []
  } else if (/^https?:\/\//.test(input.canonicalUrl)) {
    out = await articleImages(input.canonicalUrl, f, log)
  }

  log.info({ count: out.length, kinds: out.map((i) => i.kind) }, 'item images captured')
  return out
}
