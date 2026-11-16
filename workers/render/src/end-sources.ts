import type { Source } from '@reelset/core'

export const END_SOURCES_MAX = 3
export const END_SOURCE_MAX_CHARS = 48

type Input = {
  source: Source | null
  canonicalUrl: string
  mentions: readonly { url: string | null; score: number | null }[]
}

function parse(url: string | null): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function label(url: URL): string {
  const host = url.hostname.replace(/^www\./, '')
  const full = host === 'github.com' ? host + url.pathname.replace(/\/+$/, '') : host
  return full.length <= END_SOURCE_MAX_CHARS ? full : `${full.slice(0, END_SOURCE_MAX_CHARS - 1)}…`
}

/** The end card's source lines: the canonical link first, then other mention sites, one per host. */
export function endSources(input: Input): string[] {
  const hosts = new Set<string>()
  const out: string[] = []
  for (const raw of [input.canonicalUrl, ...input.mentions.map((m) => m.url)]) {
    const url = parse(raw)
    if (!url || !url.hostname) continue
    const host = url.hostname.replace(/^www\./, '')
    if (hosts.has(host)) continue
    hosts.add(host)
    out.push(label(url))
    if (out.length === END_SOURCES_MAX) break
  }
  return out
}
