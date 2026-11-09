import { describe, expect, it } from 'vitest'
import { isAdminEmail, parseAdminEmails } from './admin-emails'

describe('admin emails', () => {
  it('parses comma separated, trimmed, lowercased', () => {
    expect([...parseAdminEmails(' A@x.com, b@Y.com ,,')]).toEqual(['a@x.com', 'b@y.com'])
  })

  it('handles unset', () => {
    expect(parseAdminEmails(undefined).size).toBe(0)
    expect(isAdminEmail('a@x.com', undefined)).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(isAdminEmail('Me@Example.com', 'me@example.com,other@x.com')).toBe(true)
    expect(isAdminEmail('me@example.com', 'ME@EXAMPLE.COM')).toBe(true)
  })

  it('rejects non-members and missing email', () => {
    expect(isAdminEmail('no@example.com', 'me@example.com')).toBe(false)
    expect(isAdminEmail(null, 'me@example.com')).toBe(false)
  })
})
