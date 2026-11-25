import { describe, expect, it } from 'vitest'
import { API_CATALOG_CONTENT_TYPE, AUTH_MD, buildApiCatalog } from './agent-discovery'

describe('buildApiCatalog', () => {
  it('links the MCP endpoint to its server card and docs', () => {
    expect(buildApiCatalog()).toEqual({
      linkset: [
        {
          anchor: 'https://reelset.app/api/mcp',
          'service-desc': [
            {
              href: 'https://reelset.app/.well-known/mcp/server-card.json',
              type: 'application/json',
            },
          ],
          'service-doc': [
            { href: 'https://reelset.app/mcp', type: 'text/html' },
            { href: 'https://reelset.app/auth.md', type: 'text/markdown' },
          ],
        },
      ],
    })
  })

  it('uses the RFC 9727 linkset content type', () => {
    expect(API_CATALOG_CONTENT_TYPE).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    )
  })
})

describe('AUTH_MD', () => {
  it('is self-contained: where to get a key, how to send it, where to send it', () => {
    expect(AUTH_MD.split('\n')[0]).toMatch(/^# .*auth\.md/)
    for (const part of [
      'https://reelset.app/profile',
      'Authorization: Bearer rs_live_',
      'https://reelset.app/api/mcp',
      'https://reelset.app/.well-known/mcp/server-card.json',
      'get_credits',
      'WWW-Authenticate: Bearer',
    ])
      expect(AUTH_MD).toContain(part)
  })
})
