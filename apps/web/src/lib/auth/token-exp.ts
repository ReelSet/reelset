export const REFRESH_WINDOW_SECONDS = 300

type Cookie = { name: string; value: string }

const SESSION_COOKIE_RE = /^sb-[^.]+-auth-token(?:\.(\d+))?$/

function base64UrlToText(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function decodeValue(raw: string): string {
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    // Keep the raw value: @supabase/ssr writes base64url, which needs no URI decoding.
  }
  return value.startsWith('base64-') ? base64UrlToText(value.slice('base64-'.length)) : value
}

/** Joins the session cookie (`sb-<ref>-auth-token`, or its `.0`, `.1`... chunks) in order. */
export function sessionCookieValue(cookies: Cookie[]): string | null {
  const matches = cookies.flatMap((c) => {
    const m = SESSION_COOKIE_RE.exec(c.name)
    return m ? [{ chunk: m[1], value: c.value }] : []
  })
  const whole = matches.find((m) => m.chunk === undefined)
  if (whole) return whole.value
  const chunks = matches
    .map((m) => ({ index: Number(m.chunk), value: m.value }))
    .sort((a, b) => a.index - b.index)
  if (chunks.length === 0 || chunks.some((c, i) => c.index !== i)) return null
  return chunks.map((c) => c.value).join('')
}

/** The access token's `exp` (seconds), or null when the cookie cannot be read. */
export function accessTokenExp(cookies: Cookie[]): number | null {
  const raw = sessionCookieValue(cookies)
  if (!raw) return null
  try {
    const session = JSON.parse(decodeValue(raw)) as { access_token?: unknown; expires_at?: unknown }
    if (typeof session.access_token === 'string') {
      const payload = session.access_token.split('.')[1]
      if (payload) {
        const claims = JSON.parse(base64UrlToText(payload)) as { exp?: unknown }
        if (typeof claims.exp === 'number' && Number.isFinite(claims.exp)) return claims.exp
      }
    }
    if (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)) {
      return session.expires_at
    }
    return null
  } catch {
    return null
  }
}

/**
 * Whether the proxy must call Supabase to refresh the session. A token that is still valid for
 * more than the window needs no network round trip; anything unreadable is refreshed to be safe.
 */
export function shouldRefresh(cookies: Cookie[], nowMs: number = Date.now()): boolean {
  const exp = accessTokenExp(cookies)
  if (exp === null) return true
  return exp - nowMs / 1000 < REFRESH_WINDOW_SECONDS
}
