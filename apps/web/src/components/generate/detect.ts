import { hostOf } from '@/lib/seo/site'

export type DetectedSource = { source: string; label: string }

export function detectSource(url: string): DetectedSource {
  const host = hostOf(url)
  if (host === 'github.com' || host.endsWith('.github.com'))
    return { source: 'github', label: 'GitHub' }
  if (host === 'news.ycombinator.com') return { source: 'hn', label: 'Hacker News' }
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it')
    return { source: 'reddit', label: 'Reddit' }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be')
    return { source: 'youtube', label: 'YouTube' }
  if (host === 'arxiv.org' || host.endsWith('.arxiv.org'))
    return { source: 'papers', label: 'arXiv' }
  return { source: 'news', label: 'Article' }
}

/** Accepts "example.com/x" as https. Returns null when it is not a usable http(s) URL. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;]+$/, '')
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}
