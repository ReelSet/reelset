import { MAX_URLS_PER_REQUEST } from '@/lib/generate/types'

export type UrlCheck = { ok: true; urls: string[] } | { ok: false; message: string }

const MAX_URL_CHARS = 2048
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa']

function ipv4Private(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a = 0, b = 0] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    a >= 224
  )
}

function ipv6Private(host: string): boolean {
  const h = host.toLowerCase()
  if (h === '::' || h === '::1') return true
  if (h.startsWith('::ffff:')) return true
  return /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost') return true
  if (host.startsWith('[')) return ipv6Private(host.slice(1, -1))
  if (ipv4Private(host)) return true
  if (!host.includes('.')) return true
  return BLOCKED_SUFFIXES.some((s) => host.endsWith(s))
}

function normalize(raw: string): string | null {
  const text = raw.trim()
  if (!text || text.length > MAX_URL_CHARS) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (isBlockedHost(url.hostname)) return null
  url.hash = ''
  return url.toString()
}

/** Accepts 1-5 public http(s) URLs, trimmed and de-duplicated. */
export function validateUrls(input: unknown): UrlCheck {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, message: 'Add at least one link.' }
  }
  if (input.length > MAX_URLS_PER_REQUEST * 4) {
    return { ok: false, message: `Use at most ${MAX_URLS_PER_REQUEST} links per reel.` }
  }
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') return { ok: false, message: 'Links must be text.' }
    const url = normalize(raw)
    if (!url) {
      return { ok: false, message: `"${raw.trim().slice(0, 80)}" is not a public http(s) link.` }
    }
    seen.add(url)
  }
  if (seen.size > MAX_URLS_PER_REQUEST) {
    return { ok: false, message: `Use at most ${MAX_URLS_PER_REQUEST} links per reel.` }
  }
  return { ok: true, urls: [...seen] }
}
