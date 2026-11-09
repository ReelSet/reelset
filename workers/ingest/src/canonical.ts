import type { ItemKind } from '@reelset/core'
import type { NormalizedMention } from './types'

export type ItemTarget = {
  canonicalKey: string
  canonicalUrl: string
  kind: ItemKind
}

const MAX_KEY_LENGTH = 512
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
])
const SELF_HOSTS = new Set([
  'news.ycombinator.com',
  'reddit.com',
  'old.reddit.com',
  'np.reddit.com',
  'redd.it',
  'i.redd.it',
  'v.redd.it',
  'preview.redd.it',
])
const GITHUB_RESERVED_OWNERS = new Set([
  'about',
  'collections',
  'events',
  'explore',
  'features',
  'login',
  'marketplace',
  'notifications',
  'orgs',
  'pricing',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending',
  'users',
  'enterprise',
  'security',
  'readme',
  'customer-stories',
  'solutions',
  'resources',
])
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  'ref_url',
  'mc_cid',
  'mc_eid',
  'igshid',
  'msclkid',
])

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export function youtubeIdFromUrl(raw: string): string | null {
  const url = parseHttpUrl(raw)
  if (!url) return null
  const host = stripWww(url.hostname)
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | null | undefined = null

  if (host === 'youtu.be') {
    id = segments[0]
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') id = url.searchParams.get('v')
    else if (['shorts', 'embed', 'live', 'v'].includes(segments[0] ?? '')) id = segments[1]
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}

function githubKey(url: URL): { key: string; url: string } | null {
  if (stripWww(url.hostname) !== 'github.com') return null
  const [owner, rawRepo] = url.pathname.split('/').filter(Boolean)
  if (!owner || !rawRepo) return null
  if (GITHUB_RESERVED_OWNERS.has(owner.toLowerCase())) return null
  const repo = rawRepo.replace(/\.git$/i, '')
  if (!repo) return null
  const path = `${owner}/${repo}`.toLowerCase()
  return { key: `github:${path}`, url: `https://github.com/${path}` }
}

export function normalizeUrl(raw: string): string | null {
  const url = parseHttpUrl(raw)
  if (!url) return null
  const host = stripWww(url.hostname)
  const kept = [...url.searchParams.entries()]
    .filter(([name]) => {
      const lower = name.toLowerCase()
      return !lower.startsWith('utm_') && !TRACKING_PARAMS.has(lower)
    })
    .sort(([a], [b]) => a.localeCompare(b))
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : ''
  const path = url.pathname.replace(/\/+$/, '')
  const port = url.port && url.port !== '443' && url.port !== '80' ? `:${url.port}` : ''
  return `https://${host}${port}${path}${query}`
}

export function kindForKey(key: string): ItemKind {
  if (key.startsWith('github:')) return 'repo'
  if (key.startsWith('youtube:')) return 'video'
  if (key.startsWith('hn:') || key.startsWith('reddit:')) return 'discussion'
  return 'article'
}

export function canonicalizeUrl(raw: string): ItemTarget | null {
  const url = parseHttpUrl(raw)
  if (!url) return null

  const videoId = youtubeIdFromUrl(raw)
  if (videoId) {
    return {
      canonicalKey: `youtube:${videoId}`,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      kind: 'video',
    }
  }

  const repo = githubKey(url)
  if (repo) return { canonicalKey: repo.key, canonicalUrl: repo.url, kind: 'repo' }

  const normalized = normalizeUrl(raw)
  if (!normalized || normalized.length > MAX_KEY_LENGTH) return null
  return { canonicalKey: normalized, canonicalUrl: normalized, kind: 'article' }
}

function isSelfHost(raw: string): boolean {
  const url = parseHttpUrl(raw)
  return url ? SELF_HOSTS.has(stripWww(url.hostname)) : false
}

export function resolveItemTarget(
  mention: Pick<NormalizedMention, 'source' | 'externalId' | 'url' | 'linkedUrl'>,
): ItemTarget | null {
  const linked = mention.linkedUrl
  if (linked && !isSelfHost(linked)) return canonicalizeUrl(linked)

  if (mention.source === 'hn' || mention.source === 'reddit') {
    return {
      canonicalKey: `${mention.source}:${mention.externalId}`,
      canonicalUrl: mention.url,
      kind: 'discussion',
    }
  }
  return canonicalizeUrl(mention.url)
}
