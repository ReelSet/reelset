import { describe, expect, it } from 'vitest'
import { isSourcedQuote, repoCardSparse, withPrimarySource } from './sources'

describe('withPrimarySource', () => {
  const base = { source: 'reddit' as const, sourceLabel: 'Reddit', domain: 'github.com' }

  it('labels a GitHub repo found on Reddit as GitHub', () => {
    expect(withPrimarySource(base)).toMatchObject({ source: 'github', sourceLabel: 'GitHub' })
    expect(withPrimarySource({ ...base, source: 'hn', domain: 'arxiv.org' }).sourceLabel).toBe(
      'Research',
    )
  })

  it('leaves articles with the source they came from', () => {
    const hn = { source: 'hn' as const, sourceLabel: 'Hacker News', domain: 'mailroute.net' }
    expect(withPrimarySource(hn)).toBe(hn)
  })
})

describe('quotes and repo cards', () => {
  const props = {
    title: 'Outlook.com Is Quietly Rejecting Email from Domains Without DMARC',
    claims: ['The change was unannounced.'],
    facts: {
      hn: { points: 521, topComment: 'Nobody at Microsoft told us; it just started bouncing.' },
    },
  }

  it('shows quote marks only around words found verbatim in the sources', () => {
    expect(isSourcedQuote('Nobody announced it.', props)).toBe(false)
    expect(isSourcedQuote('The change was unannounced', props)).toBe(true)
    expect(isSourcedQuote('it just started bouncing', props)).toBe(true)
    expect(isSourcedQuote('unannounced', props)).toBe(false)
  })

  it('calls a repo card with only a name sparse', () => {
    expect(repoCardSparse({ facts: { repo: { owner: 'a', name: 'b' } } })).toBe(true)
    expect(repoCardSparse({ facts: { repo: { owner: 'a', name: 'b', stars: 705 } } })).toBe(false)
    expect(
      repoCardSparse({ facts: { repo: { owner: 'a', name: 'b', description: 'LoRA studio' } } }),
    ).toBe(false)
  })
})
