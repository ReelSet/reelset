import { describe, expect, it } from 'vitest'
import { buildPublishRequestEmail } from './publish-request'

describe('buildPublishRequestEmail', () => {
  const base = {
    adminEmail: 'a@b.co',
    ownerLabel: 'o@x.dev',
    title: 'T',
    reelUrl: 'https://r.app/r/t-1',
  }

  it('addresses the admin and links the reel and the review queue', () => {
    const email = buildPublishRequestEmail(base)
    expect(email.to).toBe('a@b.co')
    expect(email.text).toContain('o@x.dev submitted a reel')
    expect(email.text).toContain('https://r.app/r/t-1')
    expect(email.text).toContain('https://admin.reelset.app/admin/generate#submissions')
  })

  it('escapes html and keeps the subject on one line', () => {
    const email = buildPublishRequestEmail({
      ...base,
      title: '<b>x</b>\nBcc: evil',
      ownerLabel: '<i>',
    })
    expect(email.subject).not.toMatch(/[\r\n]/)
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(email.html).toContain('&lt;i&gt;')
    expect(email.html).not.toContain('<b>')
  })

  it('omits the watch link when the page url is unknown', () => {
    expect(buildPublishRequestEmail({ ...base, reelUrl: null }).text).not.toContain('Watch:')
  })
})
