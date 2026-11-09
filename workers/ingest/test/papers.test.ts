import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPaperSections } from '../src/arxiv-html'
import { arxivIdFromUrl, canonicalizeUrl, resolveItemTarget } from '../src/canonical'
import { itemScore, mentionScore } from '../src/score'
import { hfEntryToMention, papersAdapter, parseArxivFeed } from '../src/sources/papers'
import { ARXIV_ATOM, ARXIV_HTML, HF_DAILY } from './fixtures/papers'
import { makeCtx } from './helpers/ctx'
import { json, testLog, text, useFetch } from './helpers/mock-fetch'

afterEach(() => vi.unstubAllGlobals())

const now = new Date('2026-11-09T12:00:00Z')

describe('arxiv ids and canonical keys', () => {
  it('maps abs, pdf and html urls (any version) to one arxiv key', () => {
    for (const url of [
      'https://arxiv.org/abs/2611.08179v2',
      'https://arxiv.org/pdf/2611.08179.pdf',
      'https://www.arxiv.org/html/2611.08179v1',
    ]) {
      expect(canonicalizeUrl(url)).toEqual({
        canonicalKey: 'arxiv:2611.08179',
        canonicalUrl: 'https://arxiv.org/abs/2611.08179',
        kind: 'article',
      })
    }
    expect(arxivIdFromUrl('https://arxiv.org/abs/hep-th/9901001')).toBe('hep-th/9901001')
    expect(arxivIdFromUrl('https://arxiv.org/list/cs.AI/recent')).toBeNull()
  })
  it('resolves a papers mention and an HN link to the same item', () => {
    const paper = resolveItemTarget({
      source: 'papers',
      externalId: '2611.08179',
      url: 'https://arxiv.org/abs/2611.08179',
      linkedUrl: null,
    })
    const hn = resolveItemTarget({
      source: 'hn',
      externalId: '1',
      url: 'https://news.ycombinator.com/item?id=1',
      linkedUrl: 'https://arxiv.org/pdf/2611.08179v1',
    })
    expect(paper?.canonicalKey).toBe('arxiv:2611.08179')
    expect(hn?.canonicalKey).toBe(paper?.canonicalKey)
  })
})

describe('mapping', () => {
  it('maps Hugging Face entries with upvotes, comments, authors and a clean abstract', () => {
    const m = hfEntryToMention(HF_DAILY[0] as never)!
    expect(m).toMatchObject({
      source: 'papers',
      externalId: '2611.08179',
      url: 'https://arxiv.org/abs/2611.08179',
      title: 'Knowing When to Teach',
      score: 42,
      numComments: 4,
      author: 'Ada A, Bo B',
    })
    expect(m.body).toContain('Abstract: On-policy self-distillation improves reasoning')
    expect(m.publishedAt.toISOString()).toBe('2026-11-07T00:00:00.000Z')
    expect(hfEntryToMention(HF_DAILY[2] as never)).toBeNull()
  })
  it('parses arXiv atom entries without a score', () => {
    const ms = parseArxivFeed(ARXIV_ATOM)
    expect(ms.map((m) => m.externalId)).toEqual(['2611.09868', '2611.08179'])
    expect(ms[0]).toMatchObject({ title: 'CodeQuant2: Outlier Mitigation', score: null })
    expect(ms[0]!.author).toBe('Xingyu Liu, Sai Zhang')
  })
})

describe('evidence extraction', () => {
  it('returns introduction and conclusion only, with math as text and no bibliography', () => {
    const { intro, conclusion } = extractPaperSections(ARXIV_HTML)
    expect(intro).toContain('L=0')
    expect(conclusion).toContain('teachers drift')
    expect(`${intro}${conclusion}`).not.toContain('UNRELATED-MARKER')
    expect(conclusion).not.toContain('BIB-MARKER')
  })
})

describe('scoring', () => {
  const sig = (upvotes: number | null, comments: number | null, publishedAt = now) => ({
    source: 'papers' as const,
    score: upvotes,
    numComments: comments,
    publishedAt,
  })
  it('rises with upvotes and stays within 0..1', () => {
    const low = mentionScore(sig(2, 0), now)
    const mid = mentionScore(sig(40, 4), now)
    const high = mentionScore(sig(400, 30), now)
    expect(low).toBeLessThan(0.1)
    expect(mid).toBeGreaterThan(0.35)
    expect(high).toBe(1)
    expect(low).toBeLessThan(mid)
  })
  it('keeps arXiv-only papers below the default admission floor', () => {
    expect(mentionScore(sig(null, null), now)).toBeLessThan(0.35)
    expect(itemScore([sig(null, null)], now)).toBeLessThan(0.35)
  })
})

describe('papers adapter', () => {
  const ctx = makeCtx({ range: { after: new Date('2026-11-02T12:00:00Z'), before: null } })
  const hf = () => (url: string) =>
    url.startsWith('https://huggingface.co/api/daily_papers') ? json(HF_DAILY) : undefined

  it('plans a Hugging Face task and an arXiv task', () => {
    expect(papersAdapter.scopes(ctx.settings)).toEqual(['hf-daily', 'arxiv'])
    expect(papersAdapter.scopes({ ...ctx.settings, papersArxivPerCategory: 0 })).toEqual([
      'hf-daily',
    ])
  })

  it('fetches trending papers in range and attaches direct arxiv html evidence', async () => {
    const f = useFetch(hf(), (url) =>
      url === 'https://arxiv.org/html/2611.08179' ? text(ARXIV_HTML) : undefined,
    )
    const scrape = vi.fn()
    const out = await papersAdapter.fetch('hf-daily', testLog, { ...ctx, scrape: { scrape } })
    expect(out.mentions).toHaveLength(1)
    expect(out.mentions[0]!.extraTexts[0]).toContain('Introduction: Reasoning is hard')
    expect(out.mentions[0]!.extraTexts[0]).toContain('Conclusion: We conclude')
    expect(f.calls.some((u) => u.includes('firecrawl'))).toBe(false)
    expect(scrape).not.toHaveBeenCalled()
  })

  it('fetches arXiv categories politely and drops out-of-window entries', async () => {
    useFetch(
      (url) =>
        url.startsWith('https://export.arxiv.org/api/query') ? text(ARXIV_ATOM) : undefined,
      () => text('<html><body>x</body></html>'),
    )
    const out = await papersAdapter.fetch('arxiv', testLog, ctx)
    expect(out.mentions.map((m) => m.externalId)).toEqual(['2611.09868', '2611.08179'])
  })

  it('keeps the mention when evidence fetching fails', async () => {
    useFetch(hf(), (url) =>
      url.startsWith('https://arxiv.org/html/') ? text('no', 404) : undefined,
    )
    const out = await papersAdapter.fetch('hf-daily', testLog, ctx)
    expect(out.mentions).toHaveLength(1)
    expect(out.mentions[0]!.extraTexts).toEqual([])
  })
})
