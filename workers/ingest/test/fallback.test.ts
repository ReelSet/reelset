import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPageText } from '../src/article'
import { createFirecrawlFallback } from '../src/firecrawl'
import { hackerNewsAdapter } from '../src/sources/hacker-news'
import { papersAdapter } from '../src/sources/papers'
import { ARXIV_HTML, HF_DAILY } from './fixtures/papers'
import { makeCtx } from './helpers/ctx'
import { createFakeDb } from './helpers/fake-db'
import { json, testLog, text, useFetch } from './helpers/mock-fetch'

afterEach(() => vi.unstubAllGlobals())

const good = `<html><body><article><p>${'A solid paragraph about queues and retries. '.repeat(20)}</p></article></body></html>`
const thin = '<html><body><article><p>Short.</p></article></body></html>'
const challenge =
  '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
const URL_ = 'https://blog.example.com/post'
const scrapeStub = (md: string | null) => vi.fn(async (_u: string, _r: string) => md)

describe('fetchPageText fallback policy', () => {
  it('skips the paid fallback when the direct fetch is good', async () => {
    useFetch(() => text(good))
    const scrape = scrapeStub('PAID')
    const page = await fetchPageText(URL_, testLog, { scrape: { scrape } })
    expect(page.via).toBe('direct')
    expect(scrape).not.toHaveBeenCalled()
  })
  it('uses the fallback on 403, 429 and network errors', async () => {
    for (const status of [403, 429]) {
      useFetch(() => text('denied', status))
      const scrape = scrapeStub('PAID TEXT '.repeat(50))
      const page = await fetchPageText(URL_, testLog, { scrape: { scrape } })
      expect(page.via).toBe('firecrawl')
      expect(scrape).toHaveBeenCalledWith(URL_, `blocked_${status}`)
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network'))),
    )
    const scrape = scrapeStub('PAID TEXT '.repeat(50))
    await fetchPageText(URL_, testLog, { scrape: { scrape } })
    expect(scrape).toHaveBeenCalledWith(URL_, 'fetch_error')
  })
  it('uses the fallback for a challenge page and for thin text', async () => {
    useFetch(() => text(challenge))
    const a = scrapeStub('PAID TEXT '.repeat(50))
    expect((await fetchPageText(URL_, testLog, { scrape: { scrape: a } })).via).toBe('firecrawl')
    expect(a).toHaveBeenCalledWith(URL_, 'challenge_page')
    useFetch(() => text(thin))
    const b = scrapeStub('PAID TEXT '.repeat(50))
    await fetchPageText(URL_, testLog, { scrape: { scrape: b } })
    expect(b).toHaveBeenCalledWith(URL_, 'thin_text')
  })
  it('does not pay for pages that do not exist', async () => {
    useFetch(() => text('nope', 404))
    const scrape = scrapeStub('PAID')
    const page = await fetchPageText(URL_, testLog, { scrape: { scrape } })
    expect(page.via).toBe('none')
    expect(scrape).not.toHaveBeenCalled()
  })
  it('keeps thin direct text when the fallback returns nothing', async () => {
    useFetch(() => text(thin))
    const page = await fetchPageText(URL_, testLog, { scrape: { scrape: scrapeStub(null) } })
    expect(page).toMatchObject({ via: 'direct', text: 'Short.' })
  })
})

describe('adapters use the fallback only when needed', () => {
  const ctxBase = makeCtx({ range: { after: new Date('2026-11-02T12:00:00Z'), before: null } })

  it('papers: good arxiv html never triggers the fallback; a blocked fetch does', async () => {
    const hf = (url: string) =>
      url.startsWith('https://huggingface.co/api/daily_papers') ? json(HF_DAILY) : undefined
    useFetch(hf, () => text(ARXIV_HTML))
    const unused = scrapeStub('PAID')
    await papersAdapter.fetch('hf-daily', testLog, { ...ctxBase, scrape: { scrape: unused } })
    expect(unused).not.toHaveBeenCalled()

    useFetch(hf, (url) => (url.startsWith('https://arxiv.org/html/') ? text('x', 403) : undefined))
    const paid = scrapeStub('Introduction paid text. '.repeat(40))
    const out = await papersAdapter.fetch('hf-daily', testLog, {
      ...ctxBase,
      scrape: { scrape: paid },
    })
    expect(paid).toHaveBeenCalledOnce()
    expect(out.mentions[0]!.extraTexts[0]).toContain('Introduction paid text')
  })

  it('hn: article text comes from the direct fetch, fallback only on a block', async () => {
    const T0 = Math.floor(new Date('2026-11-09T08:00:00Z').getTime() / 1000)
    const hits = {
      nbPages: 1,
      hits: [
        {
          objectID: '9',
          title: 'A post',
          url: URL_,
          points: 90,
          num_comments: 0,
          created_at_i: T0,
        },
      ],
    }
    const algolia = (url: string) => (url.includes('hn.algolia.com') ? json(hits) : undefined)

    useFetch(algolia, (url) => (url === URL_ ? text(good) : undefined))
    const unused = scrapeStub('PAID')
    const ok = await hackerNewsAdapter.fetch('stories', testLog, {
      ...ctxBase,
      scrape: { scrape: unused },
    })
    expect(ok.mentions[0]!.extraTexts[0]).toContain('A solid paragraph')
    expect(unused).not.toHaveBeenCalled()

    useFetch(algolia, (url) => (url === URL_ ? text('blocked', 403) : undefined))
    const paid = scrapeStub('Paid article body. '.repeat(40))
    const blocked = await hackerNewsAdapter.fetch('stories', testLog, {
      ...ctxBase,
      scrape: { scrape: paid },
    })
    expect(paid).toHaveBeenCalledWith(URL_, 'blocked_403')
    expect(blocked.mentions[0]!.extraTexts[0]).toContain('Paid article body')
  })
})

describe('createFirecrawlFallback', () => {
  const setting = (value: unknown) => [{ value }]
  const make = (opts: { spent: string; recent?: boolean; cap?: number; res?: Response }) => {
    const fake = createFakeDb((q) => {
      if (q.sql.includes('from "app_setting"')) return setting(opts.cap ?? 1)
      if (q.sql.includes('sum(cost_usd)')) return [{ total: opts.spent }]
      if (q.sql.includes('from "spend_ledger"')) return opts.recent ? [{ id: '1' }] : []
      return undefined
    })
    const fetchImpl = vi.fn(
      async (..._a: unknown[]) =>
        opts.res ?? json({ success: true, data: { markdown: '# Full page text' } }),
    )
    const fallback = createFirecrawlFallback({
      apiKey: 'fc-secret',
      db: fake.db,
      log: testLog,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    return { fake, fetchImpl, fallback }
  }

  it('scrapes, records scrape spend with the url and reason, and never logs the key', async () => {
    const t = make({ spent: '0' })
    expect(await t.fallback.scrape(URL_, 'blocked_403')).toBe('# Full page text')
    const spend = t.fake.queries.find((q) => q.sql.startsWith('insert into "spend_ledger"'))!
    expect(spend.params).toContain('scrape')
    expect(spend.params.join(' ')).toContain('blocked_403')
    const call = t.fetchImpl.mock.calls[0]!
    expect((call[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer fc-secret' })
  })
  it('respects the daily cap and the repeat-url guard', async () => {
    const capped = make({ spent: '0.998' })
    expect(await capped.fallback.scrape(URL_, 'thin_text')).toBeNull()
    expect(capped.fetchImpl).not.toHaveBeenCalled()
    const repeat = make({ spent: '0', recent: true })
    expect(await repeat.fallback.scrape(URL_, 'thin_text')).toBeNull()
    expect(repeat.fetchImpl).not.toHaveBeenCalled()
  })
  it('does not record spend when Firecrawl rejects the request', async () => {
    const t = make({ spent: '0', res: new Response('no', { status: 402 }) })
    expect(await t.fallback.scrape(URL_, 'thin_text')).toBeNull()
    expect(t.fake.queries.some((q) => q.sql.startsWith('insert into "spend_ledger"'))).toBe(false)
  })
})
