export const SESSION_COOKIE = 'rs_sid'

const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/

export function parseSessionId(value: string | null | undefined): string | null {
  if (!value || !SESSION_ID_RE.test(value)) return null
  return value
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === 'production',
} as const
