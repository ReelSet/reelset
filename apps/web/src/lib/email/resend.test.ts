import { createLogger } from '@reelset/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUpgradeRequestEmail } from './upgrade-request'
import { escapeHtml, sendEmail } from './resend'

const log = createLogger({ app: 'test', level: 'silent' })
const email = { to: 'a@b.co', subject: 's', html: '<p>x</p>', text: 'x' }

describe('sendEmail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is a no-op without RESEND_API_KEY', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect(await sendEmail(email, log)).toEqual({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts to Resend with bearer auth and the notifications sender', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: 'em_1' })))
    expect(await sendEmail(email, log)).toEqual({ ok: true, id: 'em_1' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test')
    const body = JSON.parse(init.body as string)
    expect(body.from).toBe('reelset <notifications@reelset.app>')
    expect(body.to).toEqual(['a@b.co'])
  })

  it('never throws on http or network failure', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.mocked(fetch).mockResolvedValueOnce(new Response('no', { status: 422 }))
    expect(await sendEmail(email, log)).toEqual({ ok: false })
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    expect(await sendEmail(email, log)).toEqual({ ok: false })
  })
})

describe('upgrade request email', () => {
  it('escapes user text in html and links the admin page', () => {
    const mail = buildUpgradeRequestEmail({
      adminEmail: 'admin@x.co',
      userEmail: 'u@x.co',
      userId: 'u1',
      usedCredits: 900,
      monthlyFree: 1000,
      message: '<script>alert("hi")</script> & more',
    })
    expect(mail.to).toBe('admin@x.co')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
    expect(mail.html).toContain('&amp; more')
    expect(mail.html).toContain('https://admin.reelset.app/admin/generate#upgrades')
    expect(mail.text).toContain('900 of 1000 credits used')
  })

  it('escapes all special characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })
})
