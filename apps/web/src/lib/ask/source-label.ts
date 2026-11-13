export type SourceKind = 'hn' | 'github' | 'news' | 'reddit' | 'youtube' | 'papers'

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

export function sourceKindOf(url: string): SourceKind {
  const host = hostOf(url)
  if (host === 'news.ycombinator.com') return 'hn'
  if (isHost(host, 'github.com')) return 'github'
  if (isHost(host, 'reddit.com')) return 'reddit'
  if (isHost(host, 'youtube.com') || host === 'youtu.be') return 'youtube'
  if (isHost(host, 'arxiv.org')) return 'papers'
  return 'news'
}

const SHORT_LABELS: Partial<Record<SourceKind, string>> = {
  hn: 'HN',
  github: 'GitHub',
  reddit: 'Reddit',
  youtube: 'YouTube',
  papers: 'arXiv',
}

const MAX_LABEL = 18

// Short chip label: the platform name, or the bare domain for news.
export function chipLabel(url: string): string {
  const label =
    SHORT_LABELS[sourceKindOf(url)] ?? hostOf(url).replace(/\.(com|org|net|io|dev)$/, '')
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}
