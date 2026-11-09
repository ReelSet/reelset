import { errorFields, type Logger } from '@reelset/core'
import { USER_AGENT } from './config'
import { IMAGE_FETCH_TIMEOUT_MS, isJunkImage, normalizeImageUrl } from './images'

export const MAX_DEMO_BYTES = 20 * 1024 * 1024
const MIN_GIF_BYTES = 60 * 1024
const MAX_CANDIDATES = 5

export type DemoKind = 'gif' | 'mp4' | 'webm'
export type RepoDemo = { url: string; kind: DemoKind; bytes?: number }
export type Probe = { type: string; bytes: number | null }
export type DemoFetchers = {
  readme: (owner: string, repo: string) => Promise<string | null>
  probe: (url: string) => Promise<Probe | null>
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i
const GIF_EXT = /\.gif(?:[?#]|$)/i
const NOT_DEMO_PATH = /(?:logo|icon|banner|badge|avatar|sponsor|star-history|contributors|button)/i
const OWN_HOSTS =
  /^https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/|raw\.githubusercontent\.com\/|media\.githubusercontent\.com\/|github\.com\/[^/]+\/[^/]+\/(?:raw|blob|assets)\/)/

export type Candidate = { url: string; hint: 'video' | 'gif' | 'asset' }

function resolve(raw: string, owner: string, repo: string): string | null {
  let src = raw.trim().replace(/^<|>$/g, '').split(/\s+/)[0] ?? ''
  if (!src || src.startsWith('#')) return null
  if (!/^(?:https?:)?\/\//i.test(src)) src = src.replace(/^\.?\//, '')
  const url = normalizeImageUrl(src, `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`)
  if (!url) return null
  const blob = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+)$/.exec(url)
  return blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]!.split('?')[0]}` : url
}

/**
 * Demo media referenced in a README, in reading order: <video>/<source>, bare or linked
 * user-attachments assets, video files and GIFs hosted on GitHub or in the repo. Badges, logos
 * and other hosts' images are skipped.
 */
export function extractReadmeDemos(readme: string, owner: string, repo: string): Candidate[] {
  const text = readme.replace(/<!--[\s\S]*?-->/g, '')
  const found: { at: number; c: Candidate }[] = []
  const push = (at: number, raw: string, kind: Candidate['hint'] | null) => {
    const url = resolve(raw, owner, repo)
    if (!url || (isJunkImage(url) && !VIDEO_EXT.test(url))) return
    if (NOT_DEMO_PATH.test(new URL(url).pathname)) return
    if (!OWN_HOSTS.test(url) && !VIDEO_EXT.test(url)) return
    const hint = kind ?? (VIDEO_EXT.test(url) ? 'video' : GIF_EXT.test(url) ? 'gif' : 'asset')
    if (hint === 'gif' && !GIF_EXT.test(url) && !/user-attachments/.test(url)) return
    found.push({ at, c: { url, hint } })
  }
  for (const m of text.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    push(m.index ?? 0, m[1]!, 'video')
  }
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)/g)) {
    if (GIF_EXT.test(m[1]!) || VIDEO_EXT.test(m[1]!) || /user-attachments/.test(m[1]!)) {
      push(m.index ?? 0, m[1]!, null)
    }
  }
  for (const m of text.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (GIF_EXT.test(m[1]!) || /user-attachments/.test(m[1]!)) push(m.index ?? 0, m[1]!, null)
  }
  for (const m of text.matchAll(
    /(?:^|[\s(])(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{20,})/gim,
  )) {
    push(m.index ?? 0, m[1]!, 'asset')
  }
  for (const m of text.matchAll(/\]\(\s*(https?:\/\/[^)\s]+\.(?:mp4|webm|mov)[^)\s]*)\s*\)/gi)) {
    push(m.index ?? 0, m[1]!, 'video')
  }
  const seen = new Set<string>()
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.c)
    .filter((c) => !seen.has(c.url) && seen.add(c.url))
    .slice(0, MAX_CANDIDATES)
}

export function kindOfType(type: string, url: string): DemoKind | null {
  const t = type.toLowerCase()
  if (t.startsWith('video/webm')) return 'webm'
  if (t.startsWith('video/')) return 'mp4'
  if (t.startsWith('image/gif')) return 'gif'
  if (t.startsWith('application/octet-stream') || t === '') {
    if (VIDEO_EXT.test(url)) return /\.webm/i.test(url) ? 'webm' : 'mp4'
    if (GIF_EXT.test(url)) return 'gif'
  }
  return null
}

/** The first usable demo: a video within 20 MB beats a GIF of 60 KB to 20 MB. Never throws. */
export async function captureRepoDemo(
  owner: string,
  repo: string,
  fetchers: DemoFetchers,
  log: Logger,
): Promise<RepoDemo | null> {
  try {
    const readme = await fetchers.readme(owner, repo)
    if (!readme) return null
    let gif: RepoDemo | null = null
    for (const cand of extractReadmeDemos(readme, owner, repo)) {
      const probe = await fetchers.probe(cand.url).catch(() => null)
      if (!probe) continue
      const kind = kindOfType(probe.type, cand.url)
      if (!kind || (probe.bytes !== null && probe.bytes > MAX_DEMO_BYTES)) continue
      if (kind === 'gif') {
        if ((probe.bytes ?? MIN_GIF_BYTES) < MIN_GIF_BYTES) continue
        gif ??= { url: cand.url, kind, ...(probe.bytes ? { bytes: probe.bytes } : {}) }
        continue
      }
      log.info({ repo: `${owner}/${repo}`, kind }, 'readme demo captured')
      return { url: cand.url, kind, ...(probe.bytes ? { bytes: probe.bytes } : {}) }
    }
    if (gif) log.info({ repo: `${owner}/${repo}`, kind: 'gif' }, 'readme demo captured')
    return gif
  } catch (err) {
    log.warn({ repo: `${owner}/${repo}`, ...errorFields(err) }, 'demo capture failed')
    return null
  }
}

export function defaultDemoFetchers(): DemoFetchers {
  const headers = { 'user-agent': `${USER_AGENT} Mozilla/5.0` }
  return {
    async readme(owner, repo) {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`, {
        headers,
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      })
      return res.ok ? (await res.text()).slice(0, 400_000) : null
    },
    async probe(url) {
      const res = await fetch(url, {
        headers: { ...headers, range: 'bytes=0-1023' },
        redirect: 'follow',
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return null
      const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]
      const length = total ?? res.headers.get('content-length')
      void res.body?.cancel()
      return {
        type: res.headers.get('content-type') ?? '',
        bytes: length && /^\d+$/.test(length) ? Number(length) : null,
      }
    },
  }
}
