import { createLogger, type SpendInput, type TransitionInput } from '@reelset/core'
import { TEMPLATE_VERSION } from './constants'
import type { ContainerFetcher } from './container-client'
import type { ItemForRender, RenderDone, RenderRow, RenderStore } from './store'

export const silentLog = createLogger({ app: 'test', level: 'silent' })

export const ITEM_ID = '3f0b6c0e-6f1d-4c5a-9a53-2f7d9d1b8a11'

export const validScript = {
  version: 1,
  hook: 'Hook line.',
  beats: [
    { text: 'Beat one.', visual: { type: 'title', title: 'One' } },
    { text: 'Beat two.', visual: { type: 'image', url: 'https://i.ytimg.com/vi/x/hq.jpg' } },
  ],
  outro: 'Outro line.',
  claims: [],
}

export function makeItem(overrides: Partial<ItemForRender> = {}): ItemForRender {
  return {
    id: ITEM_ID,
    title: 'Some repo',
    status: 'embedded',
    script: validScript,
    contentHash: 'hash',
    promptVersion: 'p1',
    sourceLabel: 'GitHub',
    source: 'github',
    canonicalUrl: 'https://github.com/acme/widget',
    mentionUrl: 'https://github.com/acme/widget',
    images: [],
    facts: {},
    ...overrides,
  }
}

export class FakeStore implements RenderStore {
  renders = new Map<string, RenderRow & { error?: string; done?: RenderDone }>()
  calls: string[] = []
  constructor(public item: ItemForRender | null = makeItem()) {}

  async loadItem() {
    return this.item
  }
  async ensureRender(_itemId: string, key: string) {
    const existing = this.renders.get(key)
    if (existing) return existing
    const row = {
      id: `r-${key.slice(0, 6)}`,
      status: 'queued' as const,
      videoKey: null,
      posterKey: null,
    }
    this.renders.set(key, row)
    return row
  }
  attemptsCounted = 0
  async markRendering(key: string, countAttempt = true) {
    this.calls.push('rendering')
    if (countAttempt) this.attemptsCounted++
    const row = this.renders.get(key)
    if (row) row.status = 'rendering'
  }
  async markDone(key: string, done: RenderDone) {
    this.calls.push('done')
    const row = this.renders.get(key)
    if (row)
      Object.assign(row, {
        status: 'done',
        videoKey: done.videoKey,
        posterKey: done.posterKey,
        done,
      })
  }
  async markRetryPending(key: string) {
    this.calls.push('retry_pending')
    const row = this.renders.get(key)
    if (row?.status === 'rendering') row.status = 'queued'
  }
  async markFailed(key: string, error: string) {
    this.calls.push(`failed:${error}`)
    const row = this.renders.get(key)
    if (row) Object.assign(row, { status: 'failed', error })
  }
}

export type FakeContainerOptions = {
  renderStatus?: number
  renderBody?: unknown
  videoBytes?: number
}

export class FakeContainer implements ContainerFetcher {
  requests: { method: string; path: string; body?: unknown }[] = []
  constructor(private opts: FakeContainerOptions = {}) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const entry: { method: string; path: string; body?: unknown } = { method: request.method, path }
    if (request.method === 'POST') entry.body = await request.json()
    this.requests.push(entry)
    const videoBytes = this.opts.videoBytes ?? 1000
    if (request.method === 'POST' && path === '/render') {
      const status = this.opts.renderStatus ?? 200
      const body =
        this.opts.renderBody !== undefined
          ? this.opts.renderBody
          : {
              jobId: (entry.body as { jobId: string }).jobId,
              bytes: 1000,
              posterBytes: 50,
              durationMs: 30_000,
              ttsDurationMs: 29_000,
              ttsChars: 400,
              renderMs: 20_000,
              cover: true,
              templateVersion: TEMPLATE_VERSION,
            }
      return Response.json(body, { status })
    }
    if (request.method === 'GET' && path.endsWith('/video'))
      return new Response(new Uint8Array(videoBytes))
    if (request.method === 'GET' && path.endsWith('/poster'))
      return new Response(new Uint8Array(50))
    if (request.method === 'DELETE') return Response.json({ deleted: true })
    return new Response('nope', { status: 404 })
  }
}

export class FakeMedia {
  puts: { key: string; bytes: number; contentType?: string }[] = []
  failPuts = false
  async put(key: string, value: ArrayBuffer, options?: R2PutOptions) {
    if (this.failPuts) throw new Error('r2 down')
    this.puts.push({
      key,
      bytes: value.byteLength,
      contentType: (options?.httpMetadata as R2HTTPMetadata | undefined)?.contentType,
    })
    return null as unknown as R2Object
  }
}

export function recorders() {
  const transitions: TransitionInput[] = []
  const spends: SpendInput[] = []
  return {
    transitions,
    spends,
    transition: async (input: TransitionInput) => {
      transitions.push(input)
    },
    spend: async (input: SpendInput) => {
      spends.push(input)
    },
  }
}
