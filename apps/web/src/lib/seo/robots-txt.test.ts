import { describe, expect, it } from 'vitest'
import { buildRobotsTxt, CONTENT_SIGNAL } from './robots-txt'

describe('buildRobotsTxt', () => {
  const text = buildRobotsTxt()
  const groups = text.split('\n\n').filter((g) => g.startsWith('User-Agent:'))

  it('declares Content Signals in every user-agent group, before the rules', () => {
    expect(groups).toHaveLength(2)
    for (const g of groups) {
      const lines = g.split('\n')
      const signal = lines.indexOf(`Content-Signal: ${CONTENT_SIGNAL}`)
      expect(signal).toBeGreaterThan(0)
      expect(lines.slice(0, signal).every((l) => l.startsWith('User-Agent:'))).toBe(true)
      expect(lines[signal + 1]).toBe('Allow: /')
    }
  })

  it('keeps every crawler out of filtered variants and private paths', () => {
    for (const g of groups) {
      for (const p of [
        '/admin',
        '/api/',
        '/auth/',
        '/login',
        '/profile',
        '/*?*topic=',
        '/*?*source=',
        '/t/by/',
        '/t/*/by/',
      ])
        expect(g).toContain(`Disallow: ${p}\n`.trimEnd())
    }
  })

  it('names the AI crawlers in their own group and ends with host and sitemap', () => {
    expect(groups[1]).toContain('User-Agent: GPTBot\nUser-Agent: OAI-SearchBot')
    expect(groups[1]).toContain('User-Agent: cohere-ai')
    expect(
      text.endsWith('Host: https://reelset.app\nSitemap: https://reelset.app/sitemap.xml\n'),
    ).toBe(true)
  })
})
