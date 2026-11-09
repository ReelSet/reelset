import { describe, expect, it } from 'vitest'
import { mentionRaw } from '../src/ingest/persist'
import { repoToMention } from '../src/sources/github'
import { hitToMention } from '../src/sources/hacker-news'
import { postToMention } from '../src/sources/reddit'
import { videoToMention } from '../src/sources/youtube'

describe('mention facts capture', () => {
  it('stores github forks, language, topics and owner/name', () => {
    const m = repoToMention({
      id: 1,
      full_name: 'acme/widget',
      html_url: 'https://github.com/acme/widget',
      description: ' Fast ',
      stargazers_count: 300,
      forks_count: 12,
      created_at: '2026-11-05T00:00:00Z',
      language: 'Rust',
      topics: ['cli'],
      owner: { login: 'acme' },
    } as never)
    expect(m?.facts).toEqual({
      owner: 'acme',
      name: 'widget',
      description: 'Fast',
      forks: 12,
      language: 'Rust',
      topics: ['cli'],
    })
  })

  it('stores the reddit subreddit and youtube duration', () => {
    const post = postToMention(
      { id: 'a', created_utc: 1_700_000_000, title: 'T', subreddit: 'rust' },
      's',
    )
    expect(post?.facts).toEqual({ subreddit: 'rust' })
    const yt = videoToMention({
      videoId: 'abcdefghijk',
      title: 't',
      publishedAt: '2026-11-09T00:00:00Z',
      durationSec: 754.4,
    })
    expect(yt?.facts).toMatchObject({ durationSec: 754 })
    const none = videoToMention({
      videoId: 'abcdefghijk',
      title: 't',
      publishedAt: '2026-11-09T00:00:00Z',
    })
    expect(none?.facts?.durationSec).toBeNull()
  })

  it('serializes facts without null fields', () => {
    const m = hitToMention({ objectID: '1', title: 'x', created_at_i: 1_700_000_000, points: 5 })!
    m.facts = { topComment: 'hi', missing: null }
    expect(JSON.parse(mentionRaw(m))).toEqual({ extraTexts: [], facts: { topComment: 'hi' } })
  })
})
