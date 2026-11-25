import { describe, expect, it } from 'vitest'
import { agentLinkHeader } from './agent-links'

const BASE = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</mcp>; rel="service-doc"; type="text/html"',
]

describe('agentLinkHeader', () => {
  it('always lists the site-wide resources', () => {
    expect(agentLinkHeader('/t/ai').split(', ')).toEqual(BASE)
  })

  it('adds the markdown alternate for the homepage and reel pages', () => {
    expect(agentLinkHeader('/')).toBe(
      [...BASE, '</index.md>; rel="alternate"; type="text/markdown"'].join(', '),
    )
    expect(agentLinkHeader('/r/some-title-bf57c544')).toContain(
      '</r/some-title-bf57c544.md>; rel="alternate"; type="text/markdown"',
    )
    expect(agentLinkHeader('/r/some-title-bf57c544/')).toContain('</r/some-title-bf57c544.md>;')
    expect(agentLinkHeader('/r/x-bf57c544/opengraph-image')).not.toContain('text/markdown')
  })

  it('does not point a markdown URL at its own markdown version', () => {
    expect(agentLinkHeader('/r/some-title-bf57c544.md')).not.toContain('text/markdown')
  })
})
