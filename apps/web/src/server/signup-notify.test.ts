import { createLogger, type Database } from '@reelset/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignupInfo } from '@/lib/auth/signup-info'

const m = vi.hoisted(() => ({
  claims: [] as ({ createdAt: Date } | null)[],
  notify: true,
  claimError: null as Error | null,
}))

vi.mock('@reelset/core', async (orig) => {
  const actual = await orig<typeof import('@reelset/core')>()
  return {
    ...actual,
    claimSignupNotification: vi.fn(async () => {
      if (m.claimError) throw m.claimError
      return m.claims.shift() ?? null
    }),
    getSetting: vi.fn(async (_db: unknown, s: { key: string; default: unknown }) =>
      s.key === 'notify_signups'
        ? m.notify
        : s.key === 'admin_time_zone'
          ? 'Asia/Kolkata'
          : 'admin@reelset.test',
    ),
  }
})

const { notifyNewSignup } = await import('./signup-notify')

const log = createLogger({ app: 'test', level: 'silent' })
const db = {} as Database
const info: SignupInfo = {
  profileId: 'p1',
  email: 'new@user.dev',
  name: 'Ada <Lovelace>',
  provider: 'github',
}
const createdAt = new Date('2026-11-17T10:30:45Z')

function sentEmail() {
  const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string) as {
    to: string[]
    subject: string
    html: string
    text: string
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.claims = [{ createdAt }]
  m.notify = true
  m.claimError = null
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'em_1' }))))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('notifyNewSignup', () => {
  it('emails the admin once with name, email, provider, time in the admin zone and an admin link', async () => {
    expect(await notifyNewSignup(db, info, log)).toBe('sent')
    expect(fetch).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    expect(email.to).toEqual(['admin@reelset.test'])
    expect(email.subject).toBe('New signup: new@user.dev')
    expect(email.text).toContain('Name: Ada <Lovelace>')
    expect(email.text).toContain('Email: new@user.dev')
    expect(email.text).toContain('Provider: github')
    expect(email.text).toContain('Signed up: 17 Nov, 16:00 GMT+5:30')
    expect(email.text).toContain('https://admin.reelset.app/admin')
    expect(email.html).toContain('Ada &lt;Lovelace&gt;')
  })

  it('sends exactly once when a second claim finds the profile already notified', async () => {
    const first = await notifyNewSignup(db, info, log)
    const second = await notifyNewSignup(db, info, log)
    expect([first, second]).toEqual(['sent', 'not_new'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('claims but sends nothing when notifySignups is off', async () => {
    m.notify = false
    expect(await notifyNewSignup(db, info, log)).toBe('disabled')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never throws when Resend fails or the claim errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('down'))
    expect(await notifyNewSignup(db, info, log)).toBe('send_failed')
    m.claimError = new Error('db down')
    expect(await notifyNewSignup(db, info, log)).toBe('error')
  })

  it('handles a missing email and provider', async () => {
    await notifyNewSignup(db, { ...info, email: null, provider: null }, log)
    const email = sentEmail()
    expect(email.subject).toBe('New signup: Ada <Lovelace>')
    expect(email.text).toContain('Email: (none)')
    expect(email.text).toContain('Provider: unknown')
  })
})
