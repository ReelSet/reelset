import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_REQUEST_MESSAGE,
  INSUFFICIENT_SOURCE_MESSAGE,
  type ReelRequestRow,
} from '@reelset/core'
import { isBlockedHost } from '../src/generate/hosts'
import { processReelRequests, type GenerateDeps } from '../src/generate/process'
import { MESSAGES, classifyUrl, resolveSource } from '../src/generate/resolve'
import { createFakeDb, type RecordedQuery } from './helpers/fake-db'
import { json, testLog, text, useFetch, type Route } from './helpers/mock-fetch'

afterEach(() => vi.unstubAllGlobals())

const ARTICLE_HTML = `<html><head><title>Why we rewrote it &amp; what broke</title></head>
<body><article>${'The rewrite took six months and changed the architecture. '.repeat(20)}</article></body></html>`

const githubRoutes: Route[] = [
  (u) =>
    u === 'https://api.github.com/repos/acme/widget'
      ? json({
          id: 4242,
          full_name: 'acme/widget',
          html_url: 'https://github.com/acme/widget',
          description: 'A widget',
          stargazers_count: 12,
          created_at: '2026-01-01T00:00:00Z',
          language: 'Rust',
          archived: true,
          fork: true,
          owner: { login: 'acme' },
        })
      : undefined,
  (u) =>
    u.endsWith('/repos/acme/widget/readme') ? text('# Widget\nDoes widget things.') : undefined,
  (u) => (u.endsWith('/releases/latest') ? json({ message: 'Not Found' }, 404) : undefined),
]

describe('isBlockedHost', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.9',
    '172.20.0.1',
    '169.254.169.254',
    '::1',
    '[fd00::1]',
    'intranet',
    'box.internal',
    '2130706433',
  ])('blocks %s', (host) => expect(isBlockedHost(host)).toBe(true))
  it.each(['github.com', 'example.co.uk', '8.8.8.8', '172.32.0.1'])('allows %s', (host) =>
    expect(isBlockedHost(host)).toBe(false),
  )
})

describe('classifyUrl', () => {
  it('recognizes each supported source', () => {
    const kind = (u: string) => {
      const c = classifyUrl(u)
      return c.ok ? c.ref : c.message
    }
    expect(kind('https://github.com/Acme/Widget.git')).toEqual({
      kind: 'github',
      fullName: 'acme/widget',
    })
    expect(kind('https://news.ycombinator.com/item?id=123')).toEqual({ kind: 'hn', id: '123' })
    expect(kind('https://old.reddit.com/r/rust/comments/AbC123/title/')).toEqual({
      kind: 'reddit',
      id: 'abc123',
    })
    expect(kind('https://redd.it/abc123')).toEqual({ kind: 'reddit', id: 'abc123' })
    expect(kind('https://youtu.be/dQw4w9WgXcQ')).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(kind('https://arxiv.org/pdf/2401.01234v2')).toEqual({ kind: 'arxiv', id: '2401.01234' })
    expect(kind('https://blog.example.com/post?utm_source=x')).toEqual({
      kind: 'article',
      url: 'https://blog.example.com/post',
    })
  })
  it('rejects bad schemes, private hosts and unsupported pages', () => {
    expect(classifyUrl('ftp://example.com/x')).toEqual({ ok: false, message: MESSAGES.invalid })
    expect(classifyUrl('not a url')).toEqual({ ok: false, message: MESSAGES.invalid })
    expect(classifyUrl('http://169.254.169.254/latest')).toEqual({
      ok: false,
      message: MESSAGES.blocked,
    })
    expect(classifyUrl('https://news.ycombinator.com/news')).toEqual({
      ok: false,
      message: MESSAGES.unsupported,
    })
    expect(classifyUrl('https://example.com/photo.png')).toEqual({
      ok: false,
      message: MESSAGES.unsupported,
    })
  })
})

describe('resolveSource', () => {
  const deps = { log: testLog }

  it('reads a GitHub repo with its numeric id, README and no archived/fork veto', async () => {
    useFetch(...githubRoutes)
    const res = await resolveSource('https://github.com/acme/widget', deps)
    expect(res).toMatchObject({
      ok: true,
      mention: {
        source: 'github',
        externalId: '4242',
        title: 'acme/widget',
        extraTexts: ['# Widget\nDoes widget things.'],
      },
    })
  })

  it('fails a missing GitHub repo with a human message', async () => {
    useFetch(() => json({ message: 'Not Found' }, 404))
    expect(await resolveSource('https://github.com/acme/gone', deps)).toEqual({
      ok: false,
      message: MESSAGES.githubMissing,
    })
  })

  it('reads a Hacker News story with comments and its linked article', async () => {
    useFetch(
      (u) =>
        u === 'https://hn.algolia.com/api/v1/items/777'
          ? json({
              id: 777,
              type: 'story',
              title: 'Show HN: Widget',
              url: 'https://blog.example.com/widget',
              author: 'pg',
              points: 55,
              created_at_i: 1_760_000_000,
              children: [{ text: '<p>Nice work</p>' }],
            })
          : undefined,
      (u) => (u === 'https://blog.example.com/widget' ? text(ARTICLE_HTML) : undefined),
    )
    const res = await resolveSource('https://news.ycombinator.com/item?id=777', deps)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.mention).toMatchObject({
      source: 'hn',
      externalId: '777',
      linkedUrl: 'https://blog.example.com/widget',
    })
    expect(res.mention.extraTexts[0]).toContain('rewrite took six months')
    expect(res.mention.extraTexts).toContain('Nice work')
  })

  it('rejects an HN comment link', async () => {
    useFetch(() =>
      json({ id: 5, type: 'comment', text: 'hi', created_at_i: 1_760_000_000, children: [] }),
    )
    expect(await resolveSource('https://news.ycombinator.com/item?id=5', deps)).toEqual({
      ok: false,
      message: MESSAGES.hnNotStory,
    })
  })

  it('reads a Reddit post through Arctic Shift', async () => {
    useFetch(
      (u) =>
        u.includes('/api/posts/ids')
          ? json({
              data: [
                {
                  id: 'abc123',
                  created_utc: 1_760_000_000,
                  title: 'Rust is neat',
                  selftext: 'Long self post body',
                  subreddit: 'rust',
                  score: 40,
                  num_comments: 2,
                  url: 'https://www.reddit.com/r/rust/comments/abc123/rust_is_neat/',
                },
              ],
            })
          : undefined,
      (u) => (u.includes('/api/comments/tree') ? json({ data: [] }) : undefined),
    )
    const res = await resolveSource(
      'https://www.reddit.com/r/rust/comments/abc123/rust_is_neat/',
      deps,
    )
    expect(res).toMatchObject({
      ok: true,
      mention: { source: 'reddit', externalId: 'abc123', body: 'Long self post body' },
    })
  })

  it('fails a Reddit post Arctic Shift does not have', async () => {
    useFetch(() => json({ data: [] }))
    expect(await resolveSource('https://redd.it/zzz999', deps)).toEqual({
      ok: false,
      message: MESSAGES.redditMissing,
    })
  })

  it('reads a YouTube video title through oEmbed', async () => {
    const { calls } = useFetch((u) =>
      u.startsWith('https://www.youtube.com/oembed')
        ? json({ title: 'Build a compiler', author_name: 'Chan' })
        : undefined,
    )
    const res = await resolveSource('https://youtu.be/dQw4w9WgXcQ', deps)
    expect(res).toMatchObject({
      ok: true,
      mention: { source: 'youtube', externalId: 'dQw4w9WgXcQ', title: 'Build a compiler' },
    })
    expect(calls).toHaveLength(1)
  })

  it('fails a private YouTube video', async () => {
    useFetch(() => text('Unauthorized', 401))
    expect(await resolveSource('https://youtu.be/dQw4w9WgXcQ', deps)).toEqual({
      ok: false,
      message: MESSAGES.youtubeMissing,
    })
  })

  it('reads an arXiv paper abstract with authors', async () => {
    useFetch(
      (u) =>
        u.startsWith('https://export.arxiv.org/api/query')
          ? text(`<feed><entry>
            <id>http://arxiv.org/abs/2401.01234v1</id>
            <title>Attention revisited</title>
            <summary>We revisit attention in depth.</summary>
            <published>2026-01-02T00:00:00Z</published>
            <author><name>Ada Lovelace</name></author></entry></feed>`)
          : undefined,
      () => text('missing', 404),
    )
    const res = await resolveSource('https://arxiv.org/abs/2401.01234v1', deps)
    expect(res).toMatchObject({
      ok: true,
      mention: { source: 'papers', externalId: '2401.01234', title: 'Attention revisited' },
    })
    if (res.ok) expect(res.mention.body).toContain('Ada Lovelace')
  })

  it('reads an article with its page title and text, keyed by the normalized url', async () => {
    useFetch((u) => (u.startsWith('https://blog.example.com/') ? text(ARTICLE_HTML) : undefined))
    const res = await resolveSource('https://www.blog.example.com/post/?utm_source=x', deps)
    expect(res).toMatchObject({
      ok: true,
      mention: {
        source: 'news',
        externalId: 'https://blog.example.com/post',
        title: 'Why we rewrote it & what broke',
      },
    })
  })

  it('fails an unreachable article and never fetches a private address', async () => {
    const { calls } = useFetch(() => text('gone', 404))
    expect(await resolveSource('https://blog.example.com/gone', deps)).toEqual({
      ok: false,
      message: MESSAGES.unreadable,
    })
    calls.length = 0
    expect(await resolveSource('http://10.0.0.5/admin', deps)).toEqual({
      ok: false,
      message: MESSAGES.blocked,
    })
    expect(calls).toHaveLength(0)
  })
})

type World = {
  existing?: {
    id: string
    status: string
    queued_at: Date | null
    has_done_render: boolean
    visibility?: string
  }
  inserted?: { id: string; status: string; queued_at: Date | null; created: boolean }
  settings?: Record<string, unknown>
  upsertedHasDoneRender?: boolean
}

function request(urls: string[], over: Partial<ReelRequestRow> = {}): ReelRequestRow {
  return {
    id: 'req-1',
    user_id: 'user-1',
    urls,
    status: 'resolving',
    item_id: null,
    error: null,
    credits_charged: 100,
    refunded: false,
    via: 'web',
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as ReelRequestRow
}

function setup(req: ReelRequestRow, world: World = {}) {
  const fake = createFakeDb((q: RecordedQuery) => {
    const s = q.sql
    if (s.includes('from "app_setting"')) {
      const key = String(q.params[0])
      return key in (world.settings ?? {}) ? [{ value: world.settings![key] }] : []
    }
    if (s.includes('from "spend_ledger"')) return [{ total: '0' }]
    if (s.includes("set status = 'resolving'")) return [req]
    if (s.startsWith('select "id", "status", "queued_at"') && s.includes('"canonical_key" ='))
      return world.existing ? [world.existing] : []
    if (s.startsWith('insert into "item" '))
      return [world.inserted ?? { id: 'item-1', status: 'found', queued_at: null, created: true }]
    if (s.startsWith('insert into "mention"')) return [{ inserted: true }]
    if (s.startsWith('select "id", "status", "queued_at"')) return []
    if (s.includes('exists (') && s.includes('"has_done_render"'))
      return [{ has_done_render: world.upsertedHasDoneRender ?? false }]
    if (s.startsWith('update "item" set "queued_at" = now()')) return [{ attempts: 0 }]
    if (s.startsWith('update "item" set "status"')) return [{ id: 'item-7' }]
    if (s.startsWith('update "reel_request" set "status"')) return { rows: [], affected: 1 }
    return undefined
  })
  const queue = { send: vi.fn(async () => {}) }
  const deps: GenerateDeps = { db: fake.db, log: testLog, queue }
  return { fake, queue, deps }
}

function requestResults(fake: ReturnType<typeof createFakeDb>) {
  return fake
    .find('update "reel_request" set "status"')
    .filter((q) => q.sql.includes('"id" ='))
    .map((q) => ({ status: q.params[0], params: q.params }))
}

describe('processReelRequests', () => {
  it('turns several urls into one private, prioritized item and enqueues it right away', async () => {
    const req = request([
      'https://github.com/acme/widget',
      'https://news.ycombinator.com/item?id=777',
    ])
    const { fake, queue, deps } = setup(req)
    useFetch(
      ...githubRoutes,
      (u) =>
        u === 'https://hn.algolia.com/api/v1/items/777'
          ? json({
              id: 777,
              type: 'story',
              title: 'Show HN: Widget',
              url: 'https://blog.example.com/widget',
              created_at_i: 1_760_000_000,
              children: [],
            })
          : undefined,
      (u) => (u === 'https://blog.example.com/widget' ? text(ARTICLE_HTML) : undefined),
    )

    const result = await processReelRequests(deps)

    expect(result).toMatchObject({ claimed: 1, processing: 1, failed: 0, done: 0 })
    const itemInsert = fake.find('insert into "item" ')[0]!
    expect(itemInsert.params).toEqual(
      expect.arrayContaining(['github:acme/widget', 'private', 'user-1']),
    )
    expect(itemInsert.sql).toContain('priority_at')
    expect(itemInsert.sql).toContain('on conflict ("canonical_key") do update set "updated_at"')
    const onConflict = itemInsert.sql.split('do update set')[1]!
    expect(onConflict).not.toContain('visibility')
    expect(onConflict).toContain('"priority_at" = case when item.status in')
    expect(onConflict).toContain('coalesce(item.priority_at, now())')

    const mentionInsert = fake.find('insert into "mention"')
    expect(mentionInsert).toHaveLength(1)
    expect(mentionInsert[0]!.params.filter((p) => p === 'item-1')).toHaveLength(2)
    expect(mentionInsert[0]!.params).toEqual(expect.arrayContaining(['github', 'hn']))

    const event = fake.find('insert into "item_event"')[0]!
    expect(event.params).toEqual(expect.arrayContaining(['found', 'started']))
    const meta = String(event.params.find((p) => typeof p === 'string' && p.includes('manual')))
    expect(JSON.parse(meta)).toEqual({ manual: true, requestId: 'req-1' })
    expect(meta).not.toContain('admitted')

    expect(queue.send).toHaveBeenCalledTimes(1)
    expect(queue.send).toHaveBeenCalledWith({ itemId: 'item-1', attempt: 1 })
    expect(fake.find('"refunded" =')).toHaveLength(0)
    expect(requestResults(fake)[0]).toMatchObject({ status: 'processing' })
    expect(requestResults(fake)[0]!.params).toContain('item-1')
  })

  it('answers done at once for an item that already has a finished reel, with no fetching', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      existing: { id: 'item-9', status: 'rendered', queued_at: null, has_done_render: true },
    })
    const { calls } = useFetch(...githubRoutes)

    const result = await processReelRequests(deps)

    expect(result).toMatchObject({ claimed: 1, done: 1 })
    expect(calls).toHaveLength(0)
    expect(requestResults(fake)[0]).toMatchObject({ status: 'done' })
    expect(requestResults(fake)[0]!.params).toContain('item-9')
    expect(queue.send).not.toHaveBeenCalled()
    expect(fake.find('insert into "item" ')).toHaveLength(0)
    expect(fake.find('"refunded" =')).toHaveLength(1)
  })

  it('refuses a hidden item before any fetching and refunds, instead of answering done', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      existing: {
        id: 'item-hidden',
        status: 'rendered',
        queued_at: null,
        has_done_render: true,
        visibility: 'hidden',
      },
    })
    const { calls } = useFetch(...githubRoutes)

    const result = await processReelRequests(deps)

    expect(result).toMatchObject({ claimed: 1, failed: 1, done: 0 })
    expect(calls).toHaveLength(0)
    expect(requestResults(fake)[0]).toMatchObject({ status: 'failed' })
    expect(requestResults(fake)[0]!.params).toContain(HIDDEN_REQUEST_MESSAGE)
    expect(fake.find('insert into "item" ')).toHaveLength(0)
    expect(queue.send).not.toHaveBeenCalled()
    expect(fake.find('"refunded" =')).toHaveLength(1)
  })

  it('refuses a hidden item found only after resolving the link, without touching its priority', async () => {
    const req = request(['https://news.ycombinator.com/item?id=777'])
    const { fake, queue, deps } = setup(req, {
      existing: {
        id: 'item-hidden',
        status: 'found',
        queued_at: null,
        has_done_render: false,
        visibility: 'hidden',
      },
    })
    useFetch((u) =>
      u === 'https://hn.algolia.com/api/v1/items/777'
        ? json({
            id: 777,
            type: 'story',
            title: 'Show HN: Widget',
            url: 'https://blog.example.com/widget',
            created_at_i: 1_760_000_000,
            children: [],
          })
        : undefined,
    )

    expect(await processReelRequests(deps)).toMatchObject({ failed: 1, processing: 0 })
    expect(fake.find('insert into "item" ')).toHaveLength(0)
    expect(queue.send).not.toHaveBeenCalled()
    expect(fake.find('"refunded" =')).toHaveLength(1)
  })

  it('refunds when an upserted item turns out to be already rendered', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, deps } = setup(req, {
      inserted: { id: 'item-8', status: 'rendered', queued_at: null, created: false },
      upsertedHasDoneRender: true,
    })
    useFetch(...githubRoutes)
    expect(await processReelRequests(deps)).toMatchObject({ done: 1 })
    expect(fake.find('"refunded" =')).toHaveLength(1)
  })

  it('renders again when a rendered item has no video left, instead of answering done', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, deps } = setup(req, {
      inserted: { id: 'item-7', status: 'rendered', queued_at: null, created: false },
      upsertedHasDoneRender: false,
    })
    useFetch(...githubRoutes)
    expect(await processReelRequests(deps)).toMatchObject({ processing: 1, done: 0 })
    expect(fake.find('"refunded" =')).toHaveLength(0)
    expect(fake.find('"priority_at" = now()').length).toBeGreaterThan(0)
    expect(requestResults(fake)[0]).toMatchObject({ status: 'processing' })
  })

  it('attaches to an item already in progress without queueing it again', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      inserted: { id: 'item-5', status: 'embedded', queued_at: new Date(), created: false },
    })
    useFetch(...githubRoutes)

    const result = await processReelRequests(deps)

    expect(result).toMatchObject({ processing: 1 })
    expect(queue.send).not.toHaveBeenCalled()
    expect(fake.find('insert into "item_event"')).toHaveLength(0)
    expect(requestResults(fake)[0]!.params).toContain('item-5')
    expect(fake.find('"refunded" =')).toHaveLength(1)
  })

  it('still kicks an existing public item that was never admitted, without changing visibility', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      inserted: { id: 'item-6', status: 'found', queued_at: null, created: false },
    })
    useFetch(...githubRoutes)

    await processReelRequests(deps)

    expect(queue.send).toHaveBeenCalledWith({ itemId: 'item-6', attempt: 1 })
    expect(fake.find('"refunded" =')).toHaveLength(0)
    expect(fake.queries.some((q) => /update "item" set .*"visibility"/.test(q.sql))).toBe(false)
  })

  it('fails a request with unsupported or private urls and refunds, without queueing', async () => {
    const req = request(['http://localhost:3000/secret'])
    const { fake, queue, deps } = setup(req)
    const { calls } = useFetch()

    const result = await processReelRequests(deps)

    expect(result).toMatchObject({ claimed: 1, failed: 1 })
    const failed = requestResults(fake)[0]!
    expect(failed.status).toBe('failed')
    expect(failed.params).toContain(MESSAGES.blocked)
    expect(calls).toHaveLength(0)
    expect(queue.send).not.toHaveBeenCalled()
    expect(fake.find('"refunded" =')).toHaveLength(1)
  })

  it('still proceeds when only some urls resolve', async () => {
    const req = request(['https://github.com/acme/widget', 'http://localhost/x'])
    const { queue, deps } = setup(req)
    useFetch(...githubRoutes)
    expect(await processReelRequests(deps)).toMatchObject({ processing: 1 })
    expect(queue.send).toHaveBeenCalledTimes(1)
  })

  it('reports the repo as missing when GitHub answers 404', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, deps } = setup(req)
    useFetch(() => json({ message: 'Not Found' }, 404))
    await processReelRequests(deps)
    expect(requestResults(fake)[0]!.params).toContain(MESSAGES.githubMissing)
  })

  it('maps an item that had too little source text to the not-enough-text failure', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      inserted: { id: 'item-7', status: 'insufficient_source', queued_at: null, created: false },
    })
    useFetch(...githubRoutes)
    await processReelRequests(deps)
    expect(requestResults(fake)[0]!.params).toContain(INSUFFICIENT_SOURCE_MESSAGE)
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('sends a source-only item back through the pipeline as a requested reel: the request outranks the gate', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      inserted: { id: 'item-7', status: 'source_only', queued_at: null, created: false },
    })
    useFetch(...githubRoutes)
    const result = await processReelRequests(deps)

    expect(result).toMatchObject({ processing: 1, failed: 0 })
    const transition = fake.find('update "item" set "status"')[0]!
    expect(transition.params).toEqual(expect.arrayContaining(['found', 'item-7', 'source_only']))
    const event = fake.find('insert into "item_event"')[0]!
    expect(
      event.params.some((p) => typeof p === 'string' && p.includes('"reason":"requested"')),
    ).toBe(true)
    const reset = fake.find('"priority_at" = now()').filter((q) => q.sql.startsWith('update'))
    expect(reset).toHaveLength(1)
    expect(reset[0]!.sql).toContain('"queued_at" = $1, "attempts" = $2')
    expect(queue.send).toHaveBeenCalledWith({ itemId: 'item-7', attempt: 1 })
    expect(requestResults(fake)[0]).toMatchObject({ status: 'processing' })
    expect(fake.find('"refunded" =')).toHaveLength(0)
  })

  it('leaves requests pending while the pipeline is paused', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req, {
      settings: {
        pipeline_paused: {
          reason: 'quota',
          since: '2026-11-15T00:00:00Z',
          until: '2026-11-15T01:00:00Z',
        },
      },
    })
    const result = await processReelRequests(deps)
    expect(result).toMatchObject({ claimed: 0, gated: 'paused' })
    expect(fake.find("set status = 'resolving'")).toHaveLength(0)
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('ignores the daily spend cap: requested reels are paid with credits', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { deps } = setup(req, { settings: { pipeline_daily_spend_cap_usd: 0.01 } })
    const result = await processReelRequests(deps)
    expect(result.gated).toBeNull()
    expect(result.claimed).toBe(1)
  })

  it('puts a request back to pending when the queue send fails, and releases the item', async () => {
    const req = request(['https://github.com/acme/widget'])
    const { fake, queue, deps } = setup(req)
    queue.send.mockRejectedValue(new Error('queue down'))
    useFetch(...githubRoutes)
    const result = await processReelRequests(deps)
    expect(result).toMatchObject({ retried: 1, processing: 0 })
    expect(requestResults(fake)[0]).toMatchObject({ status: 'pending' })
    expect(fake.find('update "item" set "queued_at" = $1')).toHaveLength(1)
  })
})
