import { z } from 'zod'
import type { CreditsDto } from './api-types'

const MAX_STOCK_CREDITS = 10
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

const entrySchema = z.object({
  kind: z.string(),
  provider: z.string().nullish(),
  creator: z.string().nullish(),
  creatorUrl: z.string().nullish(),
  repo: z.string().nullish(),
  url: z.string().nullish(),
})

function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function decode(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function toCreditsDto(raw: unknown): CreditsDto | null {
  const value = decode(raw)
  if (!Array.isArray(value)) return null

  const stock: CreditsDto['stock'] = []
  const seen = new Set<string>()
  let demo: CreditsDto['demo'] = null

  for (const candidate of value) {
    const parsed = entrySchema.safeParse(candidate)
    if (!parsed.success) continue
    const entry = parsed.data

    if (entry.kind === 'stock' && (entry.provider ?? 'pexels') === 'pexels') {
      const url = safeUrl(entry.url) ?? safeUrl(entry.creatorUrl)
      if (!url || seen.has(url) || stock.length >= MAX_STOCK_CREDITS) continue
      seen.add(url)
      const creator = entry.creator?.trim().slice(0, 80) || null
      stock.push({ creator, url })
    } else if (entry.kind === 'demo' && !demo) {
      const repo = entry.repo?.trim()
      if (repo && REPO_RE.test(repo)) demo = { repo, url: `https://github.com/${repo}` }
    }
  }

  return stock.length || demo ? { stock, demo } : null
}
