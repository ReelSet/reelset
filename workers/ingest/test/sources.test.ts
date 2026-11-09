import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { githubAdapter, buildQuery, repoToMention } from '../src/sources/github'
import { hackerNewsAdapter, hitToMention, topLevelComments } from '../src/sources/hacker-news'
import { newsAdapter } from '../src/sources/news'
import { flattenTree, postToMention, redditAdapter, topCommentTexts } from '../src/sources/reddit'
import { videoToMention, youtubeAdapter } from '../src/sources/youtube'
import { ATOM_FEED, RSS_FEED } from './fixtures/feeds'
import { makeCtx } from './helpers/ctx'
import { json, testLog, text, useFetch } from './helpers/mock-fetch'

afterEach(() => vi.unstubAllGlobals())

const T0 = Math.floor(new Date('2026-11-09T08:00:00Z').getTime() / 1000)

describe('hacker news adapter', () => {
  const hits = {
    nbPages: 1,
    hits: [
      {
        objectID: '1',
        title: 'Show HN: Foo',
        url: 'https://github.com/a/foo',
        author: 'u',
        points: 120,
        num_comments: 40,
        created_at_i: T0,
      },
      {
        objectID: '2',
        title: 'Ask HN: Best queue?',
        url: null,
        author: 'v',
        points: 60,
        num_comments: 0,
        created_at_i: T0,
        story_text: '<p>I need a queue &amp; more</p>',
      },
      {
        objectID: '3',
        title: '',
        url: 'https://x.test',
        points: 99,
        num_comments: 1,
        created_at_i: T0,
      },
      { objectID: '1', title: 'dup', url: 'https://github.com/a/foo', points: 1, created_at_i: T0 },
    ],
  }
  const item = {
    children: [
      { text: '<p>First comment &amp; thoughts</p>', children: [{ text: 'nested' }] },
      { text: null },
      { text: 'Second' },
    ],
  }

  it('maps stories to mentions and fetches top comments for discussed ones', async () => {
    const { calls } = useFetch(
      (url) => (url.includes('/search_by_date') ? json(hits) : undefined),
      (url) => (url.includes('/items/1') ? json(item) : undefined),
    )
    const out = await hackerNewsAdapter.fetch('stories', testLog, makeCtx())
    expect(out.exhausted).toBe(true)
    expect(out.mentions.map((m) => m.externalId)).toEqual(['1', '2'])
    expect(out.mentions[0]).toMatchObject({
      source: 'hn',
      linkedUrl: 'https://github.com/a/foo',
      score: 120,
      extraTexts: ['First comment & thoughts', 'Second'],
    })
    expect(out.mentions[1]).toMatchObject({ linkedUrl: null, body: 'I need a queue & more' })
    expect(calls.some((u) => u.includes('numericFilters=created_at_i%3E'))).toBe(true)
    expect(calls.filter((u) => u.includes('/items/')).length).toBe(1)
  })

  it('returns empty on an empty page', async () => {
    useFetch(() => json({ hits: [], nbPages: 0 }))
    const out = await hackerNewsAdapter.fetch('stories', testLog, makeCtx())
    expect(out).toEqual({ mentions: [], exhausted: true })
  })

  it('retries a 429 then succeeds', async () => {
    let n = 0
    useFetch(() =>
      n++ === 0
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
        : json({ hits: [], nbPages: 0 }),
    )
    const out = await hackerNewsAdapter.fetch('stories', testLog, makeCtx())
    expect(out.mentions).toEqual([])
    expect(n).toBe(2)
  })

  it('fails on persistent 5xx and on bad JSON', async () => {
    useFetch(() => new Response('boom', { status: 502 }))
    await expect(hackerNewsAdapter.fetch('stories', testLog, makeCtx())).rejects.toThrow(/HTTP 502/)
    useFetch(() => text('<html>not json</html>'))
    await expect(hackerNewsAdapter.fetch('stories', testLog, makeCtx())).rejects.toThrow(
      /invalid JSON/,
    )
  })

  it('fails on a payload that does not match the schema', async () => {
    useFetch(() => json({ hits: [{ nope: true }] }))
    await expect(hackerNewsAdapter.fetch('stories', testLog, makeCtx())).rejects.toThrow()
  })

  it('keeps going when a comment fetch fails', async () => {
    useFetch(
      (url) => (url.includes('/search_by_date') ? json(hits) : undefined),
      (url) => (url.includes('/items/') ? new Response('x', { status: 500 }) : undefined),
    )
    const out = await hackerNewsAdapter.fetch('stories', testLog, makeCtx())
    expect(out.mentions).toHaveLength(2)
    expect(out.mentions[0]!.extraTexts).toEqual([])
  })

  it('stops at the time budget', async () => {
    useFetch(() => json(hits))
    const out = await hackerNewsAdapter.fetch(
      'stories',
      testLog,
      makeCtx({ deadlineAt: performance.now() - 1 }),
    )
    expect(out.mentions).toEqual([])
    expect(out.exhausted).toBe(false)
  })

  it('unit helpers', () => {
    expect(hitToMention({ objectID: '9', created_at_i: T0, title: ' ' })).toBeNull()
    expect(topLevelComments('garbage')).toEqual([])
  })
})

describe('reddit adapter', () => {
  const post = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    created_utc: T0,
    title: `Post ${id}`,
    selftext: '',
    author: 'a',
    score: 5,
    num_comments: 0,
    subreddit: 'programming',
    url: `https://www.reddit.com/r/programming/comments/${id}/`,
    ...over,
  })
  const tree = [
    {
      kind: 't1',
      data: {
        id: 'c1',
        created_utc: T0,
        body: 'Great point',
        score: 10,
        replies: {
          data: {
            children: [
              { kind: 't1', data: { id: 'c2', created_utc: T0, body: 'Nested', score: 50 } },
              { kind: 'more' },
            ],
          },
        },
      },
    },
    { kind: 't1', data: { id: 'c3', created_utc: T0, body: '[removed]', score: 99 } },
  ]

  it('maps posts, skips nsfw/removed and fetches comment trees', async () => {
    const { calls } = useFetch(
      (url) =>
        url.includes('/api/posts/search')
          ? json({
              data: [
                post('p1', { url: 'https://example.com/article', num_comments: 12 }),
                post('p2', { selftext: 'Long body text', title: 'Self post' }),
                post('p3', { over_18: true }),
                post('p5', { title: '[removed]' }),
              ],
            })
          : undefined,
      (url) => (url.includes('/api/comments/tree') ? json({ data: tree }) : undefined),
    )
    const out = await redditAdapter.fetch('programming', testLog, makeCtx())
    expect(out.exhausted).toBe(true)
    expect(out.mentions.map((m) => m.externalId)).toEqual(['p1', 'p2'])
    expect(out.mentions[0]).toMatchObject({
      linkedUrl: 'https://example.com/article',
      extraTexts: ['Nested', 'Great point'],
    })
    expect(out.mentions[1]).toMatchObject({ linkedUrl: null, body: 'Long body text' })
    expect(calls.filter((u) => u.includes('/comments/tree'))).toHaveLength(1)
  })

  it('pages backwards while full pages come back', async () => {
    const page = Array.from({ length: 100 }, (_, i) => post(`x${i}`, { created_utc: T0 - i }))
    let n = 0
    const { calls } = useFetch((url) => {
      if (!url.includes('/api/posts/search')) return undefined
      return json({ data: n++ === 0 ? page : [post('last', { created_utc: T0 - 500 })] })
    })
    const out = await redditAdapter.fetch('programming', testLog, makeCtx())
    expect(out.mentions).toHaveLength(101)
    expect(calls[1]).toContain(`before=${T0 - 99}`)
  })

  it('treats an arctic error envelope and 5xx as failures', async () => {
    useFetch(() => json({ error: 'rate limited' }))
    await expect(redditAdapter.fetch('programming', testLog, makeCtx())).rejects.toThrow(
      /rate limited/,
    )
    useFetch(() => new Response('', { status: 503 }))
    await expect(redditAdapter.fetch('programming', testLog, makeCtx())).rejects.toThrow(/HTTP 503/)
    useFetch(() => json({}))
    await expect(redditAdapter.fetch('programming', testLog, makeCtx())).rejects.toThrow(/no data/)
  })

  it('retries arctic 422 and 429', async () => {
    const statuses = [422, 429]
    let n = 0
    useFetch(() => {
      const status = statuses[n++]
      return status ? new Response('', { status }) : json({ data: [] })
    })
    const out = await redditAdapter.fetch('programming', testLog, makeCtx())
    expect(out.mentions).toEqual([])
    expect(n).toBe(3)
  })

  it('helpers', () => {
    expect(postToMention({ id: 'z', created_utc: T0, title: 'T', over_18: true }, 's')).toBeNull()
    const out: Parameters<typeof topCommentTexts>[0][number][] = []
    flattenTree([tree[0]], out)
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(topCommentTexts(out)).toEqual(['Nested', 'Great point'])
  })
})

describe('github adapter', () => {
  const repo = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    full_name: `acme/repo${id}`,
    html_url: `https://github.com/acme/repo${id}`,
    description: 'A tool',
    stargazers_count: 300,
    created_at: '2026-11-05T00:00:00Z',
    language: 'Rust',
    topics: ['cli'],
    fork: false,
    archived: false,
    owner: { login: 'acme' },
    ...over,
  })

  it('builds the search query from the range', () => {
    const q = buildQuery({
      after: new Date('2026-11-02T10:00:00Z'),
      before: new Date('2026-10-30T00:00:00Z'),
    })
    expect(q).toBe('created:>=2026-11-02 stars:>=50 fork:false created:<2026-10-31')
  })

  it('maps repos and attaches README excerpts, sending the token', async () => {
    const { calls, mock } = useFetch(
      (url) =>
        url.includes('/search/repositories')
          ? json({ items: [repo(1), repo(2, { fork: true }), repo(3, { archived: true })] })
          : undefined,
      (url) =>
        url.endsWith('/repos/acme/repo1/readme')
          ? text('# Repo1\n<!-- hidden -->\nHello')
          : undefined,
    )
    const out = await githubAdapter.fetch('trending-new', testLog, makeCtx())
    expect(out.mentions).toHaveLength(1)
    expect(out.mentions[0]).toMatchObject({
      externalId: '1',
      kind: 'repo',
      score: 300,
      linkedUrl: 'https://github.com/acme/repo1',
      body: 'A tool\nLanguage: Rust\nTopics: cli',
      extraTexts: ['# Repo1\n\nHello'],
    })
    expect(calls.some((u) => u.includes('/search/repositories?q=created'))).toBe(true)
    expect(new Headers(mock.mock.calls[0]![1]!.headers).get('authorization')).toBe(
      'Bearer gh-token',
    )
  })

  it('tolerates a missing README (404) but not a failing search', async () => {
    useFetch(
      (url) => (url.includes('/search/repositories') ? json({ items: [repo(1)] }) : undefined),
      (url) => (url.includes('/readme') ? new Response('nf', { status: 404 }) : undefined),
    )
    const ok = await githubAdapter.fetch('trending-new', testLog, makeCtx())
    expect(ok.mentions[0]!.extraTexts).toEqual([])

    useFetch(() => json({ message: 'rate limit' }, 403))
    await expect(githubAdapter.fetch('trending-new', testLog, makeCtx())).rejects.toThrow(
      /HTTP 403/,
    )
    useFetch(() => json({ items: 'bad' }))
    await expect(githubAdapter.fetch('trending-new', testLog, makeCtx())).rejects.toThrow()
  })

  it('returns empty for no results', async () => {
    useFetch(() => json({ items: [] }))
    expect(await githubAdapter.fetch('trending-new', testLog, makeCtx())).toEqual({
      mentions: [],
      exhausted: true,
    })
  })

  it('skips repos with unparseable dates', () => {
    expect(repoToMention({ ...repo(9), created_at: 'nope' } as never)).toBeNull()
  })
})

describe('youtube adapter', () => {
  // Shape recorded from render /youtube/search (docs/contracts.md)
  const recorded = {
    status: 'ok',
    videos: [
      {
        videoId: 'aaaaaaaaaaa',
        title: 'Rust in 100 seconds',
        channelName: 'Fireship',
        channelId: 'UC1',
        url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        publishedAt: '2026-11-09T01:00:00-08:00',
        viewCount: 7259,
        durationSec: 130,
        description: '  Rust is a systems language  ',
        thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hq.jpg',
      },
      {
        videoId: 'bbbbbbbbbbb',
        title: 'Old video',
        channelName: null,
        publishedAt: '2026-10-01T00:00:00Z',
        viewCount: null,
        durationSec: null,
        description: '',
      },
      { videoId: 'ccccccccccc', title: 'Bad date', publishedAt: 'nope', viewCount: 1 },
    ],
    failedQueries: ['ai agents'],
  }

  const render = (res: () => Response) => {
    const calls: { url: string; init?: RequestInit }[] = []
    return {
      calls,
      fetcher: {
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(url), init })
          return res()
        },
      } as Pick<Fetcher, 'fetch'>,
    }
  }

  it('posts the configured settings to the render service', async () => {
    const r = render(() => json(recorded))
    await youtubeAdapter.fetch('search', testLog, makeCtx({ render: r.fetcher }))
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]!.url).toBe('https://render.internal/youtube/search')
    expect(r.calls[0]!.init?.method).toBe('POST')
    expect(JSON.parse(String(r.calls[0]!.init?.body))).toEqual({
      queries: ['rust tutorial', 'ai agents'],
      maxAgeDays: 7,
      perQueryLimit: 10,
    })
  })

  it('maps videos to mentions, dropping bad dates and videos outside the range', async () => {
    const r = render(() => json(recorded))
    const out = await youtubeAdapter.fetch('search', testLog, makeCtx({ render: r.fetcher }))
    expect(out.exhausted).toBe(true)
    expect(out.mentions).toHaveLength(1)
    expect(out.mentions[0]).toMatchObject({
      source: 'youtube',
      externalId: 'aaaaaaaaaaa',
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      linkedUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      title: 'Rust in 100 seconds',
      author: 'Fireship',
      body: 'Rust is a systems language',
      score: 7259,
      numComments: null,
    })
    expect(out.mentions[0]!.publishedAt.toISOString()).toBe('2026-11-09T09:00:00.000Z')
  })

  it('maps missing optional fields to nulls', () => {
    const m = videoToMention({
      videoId: 'zzzzzzzzzzz',
      title: 't',
      publishedAt: '2026-11-09T00:00:00Z',
    })
    expect(m).toMatchObject({ score: null, author: null, body: null })
  })

  it('fails the task on a non-2xx response', async () => {
    const r = render(() => json({ status: 'error', reason: 'blocked' }, 502))
    await expect(
      youtubeAdapter.fetch('search', testLog, makeCtx({ render: r.fetcher })),
    ).rejects.toThrow(/HTTP 502/)
  })

  it('fails the task on a status error body and on a missing binding', async () => {
    const r = render(() => json({ status: 'error', reason: 'library broken' }))
    await expect(
      youtubeAdapter.fetch('search', testLog, makeCtx({ render: r.fetcher })),
    ).rejects.toThrow(/library broken/)
    await expect(
      youtubeAdapter.fetch('search', testLog, makeCtx({ render: undefined })),
    ).rejects.toThrow(/RENDER/)
  })

  it('warns but succeeds when only some queries failed', async () => {
    const warn = vi.fn()
    const log = { child: () => log, info: vi.fn(), warn, debug: vi.fn(), error: vi.fn() } as never
    const r = render(() => json(recorded))
    await youtubeAdapter.fetch('search', log, makeCtx({ render: r.fetcher }))
    expect(warn).toHaveBeenCalledWith({ failedQueries: ['ai agents'] }, expect.any(String))
  })

  it('plans one search task only when queries exist', () => {
    const s = makeCtx().settings
    expect(youtubeAdapter.scopes(s)).toEqual(['search'])
    expect(youtubeAdapter.scopes({ ...s, youtubeSearchQueries: [] })).toEqual([])
  })
})

describe('news adapter', () => {
  it('parses rss feeds into article mentions inside the range', async () => {
    useFetch(() => text(RSS_FEED))
    const out = await newsAdapter.fetch('https://blog.example.com/feed', testLog, makeCtx())
    expect(out.mentions).toHaveLength(1)
    expect(out.mentions[0]).toMatchObject({
      source: 'news',
      kind: 'article',
      externalId: 'post-123',
      score: null,
      linkedUrl: 'https://blog.example.com/queues-v2?utm_source=rss',
    })
    expect(out.mentions[0]!.body).toContain('batching & retries')
  })

  it('parses atom feeds', async () => {
    useFetch(() => text(ATOM_FEED))
    const out = await newsAdapter.fetch('https://atom.example.com/feed.xml', testLog, makeCtx())
    expect(out.mentions.map((m) => m.externalId)).toEqual(['tag:atom.example.com,2026:rust-2'])
  })

  it('handles empty feeds, http failures and garbage', async () => {
    useFetch(() => text('<rss><channel></channel></rss>'))
    expect((await newsAdapter.fetch('https://a.test/f', testLog, makeCtx())).mentions).toEqual([])
    useFetch(() => text('<html>captcha</html>'))
    expect((await newsAdapter.fetch('https://a.test/f', testLog, makeCtx())).mentions).toEqual([])
    useFetch(() => new Response('', { status: 500 }))
    await expect(newsAdapter.fetch('https://a.test/f', testLog, makeCtx())).rejects.toThrow(
      /HTTP 500/,
    )
  })
})

beforeEach(() => vi.unstubAllGlobals())
