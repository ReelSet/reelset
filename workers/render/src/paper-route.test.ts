import { describe, expect, it } from 'vitest'
import { PAPER_PARSER_VERSION } from '@reelset/core'
import type { ContainerFetcher } from './container-client'
import { handleParsePaper } from './paper-route'
import { silentLog } from './testing'

const paper = (figures: unknown[]) => ({
  arxivId: '2611.08264',
  source: 'html',
  version: PAPER_PARSER_VERSION,
  title: 'T',
  authors: ['A'],
  affiliations: [],
  abstract: 'abs',
  sections: [{ heading: 'Method', level: 2, kind: 'method', markdown: 'text' }],
  tables: [],
  figures,
  equations: [],
  links: [],
  markdown: '# T',
})

class FakeR2 {
  store = new Map<string, { body: Uint8Array | string; meta: unknown }>()
  async get(key: string) {
    const hit = this.store.get(key)
    return hit ? { json: async () => JSON.parse(String(hit.body)) } : null
  }
  async put(key: string, body: Uint8Array | string, meta: unknown) {
    this.store.set(key, { body, meta })
  }
}

const req = (body: unknown) =>
  new Request('https://render.internal/parse/paper', { method: 'POST', body: JSON.stringify(body) })

function setup(containerResponse: () => Response) {
  const media = new FakeR2()
  let calls = 0
  const container: ContainerFetcher = {
    fetch: async () => {
      calls++
      return containerResponse()
    },
  }
  const deps = {
    media: media as unknown as R2Bucket,
    publicBase: 'https://media.test',
    container,
    log: silentLog,
  }
  return { media, deps, calls: () => calls }
}

describe('handleParsePaper', () => {
  it('stores hi-res figures in R2, keeps LaTeXML urls and caches the parsed paper', async () => {
    const png = btoa('\x89PNG-bytes')
    const { media, deps, calls } = setup(() =>
      Response.json({
        status: 'ok',
        stats: { ms: 5 },
        paper: paper([
          { label: 'Figure 1', caption: 'c', hires: true, origin: 'eprint', data: png, ext: 'png' },
          {
            label: 'Figure 2',
            caption: 'd',
            hires: false,
            origin: 'latexml',
            url: 'https://arxiv.org/html/x/x2.png',
          },
        ]),
      }),
    )
    const res = await handleParsePaper(req({ arxivId: '2611.08264v2' }), deps)
    const body = (await res.json()) as { status: string; paper: { figures: { url: string }[] } }
    expect(body.status).toBe('ok')
    expect(body.paper.figures[0]?.url).toBe('https://media.test/papers/2611.08264/fig-1.png')
    expect(body.paper.figures[1]?.url).toBe('https://arxiv.org/html/x/x2.png')
    expect(media.store.has('papers/2611.08264/fig-1.png')).toBe(true)
    expect(media.store.has('papers/2611.08264/paper.json')).toBe(true)
    expect(JSON.stringify(body)).not.toContain('"data"')

    const again = await handleParsePaper(req({ arxivId: '2611.08264' }), deps)
    expect(((await again.json()) as { cached?: boolean }).cached).toBe(true)
    expect(calls()).toBe(1)
  })

  it('reports not_parseable without caching, and maps container failures to 502', async () => {
    const failed = setup(() => Response.json({ status: 'failed' }))
    const res = await handleParsePaper(req({ arxivId: '2611.00001' }), failed.deps)
    expect(await res.json()).toEqual({ status: 'failed', reason: 'not_parseable' })
    expect(failed.media.store.size).toBe(0)

    const down = setup(() => new Response('boom', { status: 500 }))
    expect((await handleParsePaper(req({ arxivId: '2611.00001' }), down.deps)).status).toBe(502)

    const junk = setup(() => Response.json({ nope: true }))
    expect((await handleParsePaper(req({ arxivId: '2611.00001' }), junk.deps)).status).toBe(502)
  })

  it('rejects ids that are not arXiv ids', async () => {
    const { deps } = setup(() => Response.json({}))
    for (const arxivId of ['../x', 'http://a', '2611.1', '']) {
      expect((await handleParsePaper(req({ arxivId }), deps)).status).toBe(400)
    }
  })
})
