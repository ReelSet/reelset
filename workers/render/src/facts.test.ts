import { describe, expect, it } from 'vitest'
import { buildFacts, excerpt, formatDuration, type MentionForFacts } from './facts'

const base = { title: null, author: null, score: null, numComments: null, raw: null }
const m = (over: Partial<MentionForFacts> & Pick<MentionForFacts, 'source' | 'url'>) => ({
  ...base,
  ...over,
})

describe('buildFacts', () => {
  it('maps a github mention to repo facts from stored data only', () => {
    const facts = buildFacts(
      [
        m({
          source: 'github',
          url: 'https://github.com/acme/widget',
          title: 'acme/widget',
          author: 'acme',
          score: 1234,
          raw: {
            facts: {
              forks: 56,
              language: 'Rust',
              topics: ['cli', 'tui'],
              description: ' Fast widgets ',
              latestRelease: 'v1.2.0',
            },
          },
        }),
      ],
      'https://github.com/acme/widget',
    )
    expect(facts).toEqual({
      repo: {
        owner: 'acme',
        name: 'widget',
        description: 'Fast widgets',
        stars: 1234,
        forks: 56,
        language: 'Rust',
        topics: ['cli', 'tui'],
        latestRelease: 'v1.2.0',
      },
    })
  })

  it('omits numbers that were never captured instead of inventing them', () => {
    const facts = buildFacts(
      [
        m({
          source: 'github',
          url: 'https://github.com/a/b',
          title: 'a/b',
          raw: { extraTexts: [] },
        }),
      ],
      'https://github.com/a/b',
    )
    expect(facts.repo).toEqual({ owner: 'a', name: 'b' })
  })

  it('collects hn, reddit and youtube groups', () => {
    const facts = buildFacts(
      [
        m({
          source: 'hn',
          url: 'https://news.ycombinator.com/item?id=1',
          author: 'pg',
          score: 321,
          numComments: 88,
          raw: { facts: { topComment: 'Nice work' } },
        }),
        m({
          source: 'reddit',
          url: 'https://reddit.com/r/rust/comments/x/',
          author: 'u1',
          score: 900,
          numComments: 40,
          raw: { facts: { subreddit: 'rust' } },
        }),
        m({
          source: 'youtube',
          url: 'https://youtube.com/watch?v=abc',
          author: 'Fireship',
          score: 1_500_000,
          raw: { facts: { durationSec: 754 } },
        }),
      ],
      'https://example.com/post',
    )
    expect(facts.hn).toEqual({ points: 321, comments: 88, author: 'pg', topComment: 'Nice work' })
    expect(facts.reddit).toEqual({ subreddit: 'rust', upvotes: 900, comments: 40, author: 'u1' })
    expect(facts.youtube).toEqual({ channel: 'Fireship', views: 1_500_000, duration: '12:34' })
    expect(facts.article).toEqual({ site: 'example.com' })
  })

  it('falls back to the subreddit in the permalink', () => {
    const facts = buildFacts(
      [m({ source: 'reddit', url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/', score: 5 })],
      'https://x.com/a',
    )
    expect(facts.reddit?.subreddit).toBe('LocalLLaMA')
  })

  it('uses the highest scored mention per source (first in order)', () => {
    const facts = buildFacts(
      [m({ source: 'hn', url: 'u1', score: 500 }), m({ source: 'hn', url: 'u2', score: 5 })],
      'https://github.com/a/b',
    )
    expect(facts.hn?.points).toBe(500)
    expect(facts.article).toBeUndefined()
  })

  it('rejects negative or non-finite counts', () => {
    const facts = buildFacts(
      [m({ source: 'hn', url: 'u', score: -3, numComments: Number.NaN, author: 'x' })],
      'https://github.com/a/b',
    )
    expect(facts.hn).toEqual({ author: 'x' })
  })

  it('takes the news site from the mention url', () => {
    const facts = buildFacts(
      [m({ source: 'news', url: 'https://www.theverge.com/a', author: 'Jane' })],
      'https://www.theverge.com/a',
    )
    expect(facts.article).toEqual({ site: 'theverge.com', author: 'Jane' })
  })
})

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(0)).toBeUndefined()
    expect(formatDuration(null)).toBeUndefined()
  })
})

describe('mention bodies', () => {
  it('reads a paper mention body for authors and abstract when raw facts lack them', () => {
    const facts = buildFacts(
      [
        m({
          source: 'papers',
          url: 'https://arxiv.org/abs/2611.03953',
          score: 42,
          body: 'Authors: Sinuo Wang, Jiacheng Lu et al. Abstract: Multi-teacher on-policy distillation consolidates experts.',
        }),
      ],
      'https://arxiv.org/abs/2611.03953',
    )
    expect(facts.paper).toEqual({
      authors: ['Sinuo Wang', 'Jiacheng Lu'],
      abstract: 'Multi-teacher on-policy distillation consolidates experts.',
      upvotes: 42,
    })
  })

  it('keeps a short, sentence-cut excerpt of a reddit post body', () => {
    const body = `Training is much faster, uses far less memory. ${'More words here. '.repeat(30)}`
    const facts = buildFacts(
      [m({ source: 'reddit', url: 'https://reddit.com/r/x/comments/1/', body })],
      'https://github.com/a/b',
    )
    expect(facts.reddit?.text?.startsWith('Training is much faster')).toBe(true)
    expect(facts.reddit!.text!.length).toBeLessThanOrEqual(280)
    expect(facts.reddit!.text!.endsWith('.')).toBe(true)
    expect(excerpt('[link](https://x.y) short')).toBeUndefined()
  })
})

describe('buildFacts repo identity', () => {
  it('names the repo from a github canonical URL when no github mention was stored', () => {
    const facts = buildFacts(
      [
        m({
          source: 'reddit',
          url: 'https://www.reddit.com/r/StableDiffusion/comments/abc/x/',
          score: 75,
        }),
      ],
      'https://github.com/shootthesound/fizgig',
    )
    expect(facts.repo).toEqual({ owner: 'shootthesound', name: 'fizgig' })
    expect(facts.reddit?.upvotes).toBe(75)
  })

  it('adds no repo for other hosts', () => {
    expect(buildFacts([], 'https://mailroute.net/blog/x').repo).toBeUndefined()
  })
})
