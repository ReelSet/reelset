import { readFileSync } from 'node:fs'
import { StaleTransitionError, renderKey } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { processRenderJob, type ConsumerDeps } from './consumer'
import { TEMPLATE_VERSION } from './constants'
import {
  FakeContainer,
  FakeMedia,
  FakeStore,
  ITEM_ID,
  makeItem,
  recorders,
  silentLog,
} from './testing'
import { posterKeyFor, videoKeyFor } from './keys'

async function keyFor(voice = 'en-US-AriaNeural') {
  return renderKey({
    itemId: ITEM_ID,
    contentHash: 'hash',
    promptVersion: 'p1',
    templateVersion: TEMPLATE_VERSION,
    voice,
  })
}

function setup(opts: { store?: FakeStore; containers?: FakeContainer[]; media?: FakeMedia } = {}) {
  const store = opts.store ?? new FakeStore()
  const containers = opts.containers ?? [new FakeContainer()]
  const media = opts.media ?? new FakeMedia()
  const rec = recorders()
  const deps: ConsumerDeps = {
    store,
    containers,
    media: media as unknown as ConsumerDeps['media'],
    transition: rec.transition,
    spend: rec.spend,
    voice: 'en-US-AriaNeural',
    log: silentLog,
  }
  return { deps, store, containers, media, rec }
}

const body = { itemId: ITEM_ID, attempt: 0 }
const path = (c: FakeContainer) =>
  c.requests.map((r) => `${r.method} ${r.path.replace(/r[0-9a-f]{40}/, 'JOB')}`)

describe('processRenderJob', () => {
  it('renders a fresh embedded item end to end', async () => {
    const { deps, store, containers, media, rec } = setup()
    const key = await keyFor()

    const result = await processRenderJob(deps, body, 1)

    expect(result).toEqual({ action: 'ack' })
    expect(path(containers[0]!)).toEqual([
      'POST /render',
      'GET /render/JOB/video',
      'GET /render/JOB/poster',
      'DELETE /render/JOB',
    ])
    const renderCall = containers[0]!.requests[0]!.body as Record<string, unknown>
    expect(renderCall).toMatchObject({
      title: 'Some repo',
      sourceLabel: 'GitHub',
      voice: 'en-US-AriaNeural',
      imageUrls: ['https://i.ytimg.com/vi/x/hq.jpg'],
      source: 'github',
      canonicalUrl: 'https://github.com/acme/widget',
      sourceImageUrls: ['https://opengraph.githubassets.com/1/acme/widget'],
    })
    expect(media.puts.map((p) => [p.key, p.contentType])).toEqual([
      [videoKeyFor(ITEM_ID, key), 'video/mp4'],
      [posterKeyFor(ITEM_ID, key), 'image/jpeg'],
    ])
    expect(store.calls).toEqual(['rendering', 'done'])
    expect(store.renders.get(key)?.done).toMatchObject({
      bytes: 1000,
      videoDurationMs: 30_000,
      renderMs: 20_000,
    })
    expect(rec.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      'embedded->voiced',
      'voiced->rendered',
    ])
    expect(rec.transitions[0]?.meta).toEqual({ ttsChars: 400, ttsDurationMs: 29_000 })
    expect(rec.spends.map((s) => s.category)).toEqual(['tts', 'render'])
    expect(rec.spends[0]).toMatchObject({ units: 400, costUsd: 0 })
    expect(rec.spends[1]?.costUsd).toBeGreaterThan(0)
  })

  it('does not call the container for a duplicate delivery of an already done render', async () => {
    const store = new FakeStore()
    const key = await keyFor()
    store.renders.set(key, {
      id: 'r1',
      status: 'done',
      videoKey: videoKeyFor(ITEM_ID, key),
      posterKey: posterKeyFor(ITEM_ID, key),
    })
    const { deps, containers, media, rec } = setup({ store })

    const result = await processRenderJob(deps, body, 1)

    expect(result).toEqual({ action: 'ack' })
    expect(containers[0]!.requests).toEqual([])
    expect(media.puts).toEqual([])
    expect(store.calls).toEqual([])
    expect(rec.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      'embedded->voiced',
      'voiced->rendered',
    ])
    expect(rec.spends).toEqual([])
  })

  it('re-renders an already rendered item for a new template without touching its status', async () => {
    const { deps, store, media, rec } = setup({
      store: new FakeStore(makeItem({ status: 'rendered' })),
    })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(media.puts).toHaveLength(2)
    expect(store.calls).toEqual(['rendering', 'done'])
    expect(rec.transitions).toEqual([])
  })

  it('keeps the item rendered when a re-render fails terminally', async () => {
    const { deps, store, rec } = setup({
      store: new FakeStore(makeItem({ status: 'rendered' })),
      containers: [
        new FakeContainer({ renderStatus: 400, renderBody: { error: 'invalid_input' } }),
      ],
    })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(store.calls).toContain('failed:invalid_input')
    expect(rec.transitions).toEqual([])
  })

  it('acks without doing anything when the item is failed or not yet embedded', async () => {
    for (const status of ['failed', 'found'] as const) {
      const { deps, containers, rec } = setup({ store: new FakeStore(makeItem({ status })) })
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(containers[0]!.requests).toEqual([])
      expect(rec.transitions).toEqual([])
    }
  })

  it('resumes a voiced item with a done render by only finishing the rendered transition', async () => {
    const store = new FakeStore(makeItem({ status: 'voiced' }))
    const key = await keyFor()
    store.renders.set(key, { id: 'r1', status: 'done', videoKey: 'v', posterKey: 'p' })
    const { deps, containers, rec } = setup({ store })

    expect(await processRenderJob(deps, body, 2)).toEqual({ action: 'ack' })
    expect(containers[0]!.requests).toEqual([])
    expect(rec.transitions.map((t) => `${t.from}->${t.to}`)).toEqual(['voiced->rendered'])
  })

  it('renders a voiced item without a done render and skips the embedded->voiced transition', async () => {
    const { deps, rec } = setup({ store: new FakeStore(makeItem({ status: 'voiced' })) })
    await processRenderJob(deps, body, 1)
    expect(rec.transitions.map((t) => `${t.from}->${t.to}`)).toEqual(['voiced->rendered'])
  })

  it('re-renders when the previous attempt for the same key failed', async () => {
    const store = new FakeStore()
    const key = await keyFor()
    store.renders.set(key, { id: 'r1', status: 'failed', videoKey: null, posterKey: null })
    const { deps, containers } = setup({ store })
    await processRenderJob(deps, body, 1)
    expect(containers[0]!.requests[0]?.path).toBe('/render')
  })

  it('retries with backoff on a transient container failure before the last attempt', async () => {
    const container = new FakeContainer({
      renderStatus: 502,
      renderBody: { error: 'tts_unavailable' },
    })
    const { deps, store, rec } = setup({ containers: [container] })

    const result = await processRenderJob(deps, body, 2)

    expect(result).toEqual({ action: 'retry', delaySeconds: 60 })
    expect(store.calls).toEqual(['rendering'])
    expect(rec.transitions).toEqual([])
  })

  it('marks the render and item failed and dead-letters on the last attempt', async () => {
    const container = new FakeContainer({
      renderStatus: 502,
      renderBody: { error: 'tts_unavailable' },
    })
    const { deps, store, rec } = setup({ containers: [container] })

    const result = await processRenderJob(deps, body, 4)

    expect(result).toEqual({ action: 'dead_letter' })
    expect(store.calls).toEqual(['rendering', 'failed:tts_unavailable'])
    expect(rec.transitions).toEqual([
      { itemId: ITEM_ID, from: 'embedded', to: 'failed', attempt: 4, error: 'tts_unavailable' },
    ])
  })

  it('fails immediately without retrying on a permanent error code', async () => {
    const container = new FakeContainer({
      renderStatus: 400,
      renderBody: { error: 'invalid_input' },
    })
    const { deps, store, rec } = setup({ containers: [container] })

    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(store.calls).toEqual(['rendering', 'failed:invalid_input'])
    expect(rec.transitions[0]).toMatchObject({
      from: 'embedded',
      to: 'failed',
      error: 'invalid_input',
    })
  })

  it('fails the item without a render row when the script is invalid', async () => {
    const { deps, store, rec, containers } = setup({
      store: new FakeStore(makeItem({ script: { nope: true } })),
    })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(store.renders.size).toBe(0)
    expect(containers[0]!.requests).toEqual([])
    expect(rec.transitions[0]).toMatchObject({ to: 'failed', error: 'script_invalid' })
  })

  it('acks on a stale transition', async () => {
    const { deps, rec } = setup()
    deps.transition = async (input) => {
      rec.transitions.push(input)
      throw new StaleTransitionError(ITEM_ID, 'embedded')
    }
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(rec.transitions).toHaveLength(1)
  })

  it('tries the next container slot when the first is busy and reuses it for downloads', async () => {
    const busy = new FakeContainer({ renderStatus: 409, renderBody: { error: 'busy' } })
    const free = new FakeContainer()
    const { deps } = setup({ containers: [busy, free] })

    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(path(busy)).toEqual(['POST /render'])
    expect(path(free)).toContain('GET /render/JOB/video')
  })

  it('retries when every slot is busy', async () => {
    const busy = () => new FakeContainer({ renderStatus: 409, renderBody: { error: 'busy' } })
    const { deps } = setup({ containers: [busy(), busy()] })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'retry', delaySeconds: 30 })
  })

  it('retries on an R2 upload failure and still cleans up the container job', async () => {
    const media = new FakeMedia()
    media.failPuts = true
    const { deps, containers } = setup({ media })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'retry', delaySeconds: 30 })
    expect(path(containers[0]!).at(-1)).toBe('DELETE /render/JOB')
  })

  it('treats a video larger than 25 MB as a permanent failure', async () => {
    const container = new FakeContainer({
      renderBody: {
        jobId: 'x',
        bytes: 26 * 1024 * 1024,
        posterBytes: 50,
        durationMs: 30_000,
        ttsDurationMs: 1,
        ttsChars: 1,
        renderMs: 1,
        templateVersion: TEMPLATE_VERSION,
      },
    })
    const { deps, rec } = setup({ containers: [container] })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(rec.transitions[0]).toMatchObject({ to: 'failed', error: 'too_large' })
  })

  it('rejects a download whose size disagrees with the metadata', async () => {
    const { deps, media } = setup({ containers: [new FakeContainer({ videoBytes: 999 })] })
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'retry', delaySeconds: 30 })
    expect(media.puts).toEqual([])
  })

  it('drops malformed messages and unknown items', async () => {
    const { deps } = setup()
    expect(await processRenderJob(deps, { itemId: 'nope' }, 1)).toEqual({ action: 'ack' })
    const missing = setup({ store: new FakeStore(null) })
    expect(await processRenderJob(missing.deps, body, 1)).toEqual({ action: 'ack' })
  })

  it('does not fail the job when spend recording throws', async () => {
    const { deps, rec } = setup()
    deps.spend = async () => {
      throw new Error('db hiccup')
    }
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(rec.transitions.at(-1)).toMatchObject({ to: 'rendered' })
  })

  it.each([[undefined], ['1']])(
    'discards a render from a container reporting template %s and retries',
    async (reported) => {
      const container = new FakeContainer({
        renderBody: {
          jobId: 'j',
          bytes: 1000,
          posterBytes: 50,
          durationMs: 30_000,
          ttsDurationMs: 29_000,
          ttsChars: 400,
          renderMs: 20_000,
          templateVersion: reported,
        },
      })
      const { deps, store, media, rec } = setup({ containers: [container] })

      const result = await processRenderJob(deps, body, 1)

      expect(result).toEqual({ action: 'retry', delaySeconds: 30 })
      expect(media.puts).toEqual([])
      expect(store.calls).toEqual(['rendering'])
      expect(rec.transitions).toEqual([])
      expect(path(container)).toEqual(['POST /render', 'DELETE /render/JOB'])
    },
  )

  it('records stale_container_template on the render when retries run out', async () => {
    const container = new FakeContainer({
      renderBody: {
        jobId: 'j',
        bytes: 1000,
        posterBytes: 50,
        durationMs: 30_000,
        ttsDurationMs: 0,
        ttsChars: 0,
        renderMs: 1,
      },
    })
    const { deps, store } = setup({ containers: [container] })

    const result = await processRenderJob(deps, body, 4)

    expect(result).toEqual({ action: 'dead_letter' })
    expect(store.calls).toContain('failed:stale_container_template')
  })

  it('keeps the container template version in sync with the worker constant', () => {
    const py = readFileSync(new URL('../container/reel/version.py', import.meta.url), 'utf8')
    expect(py).toContain(`TEMPLATE_VERSION = "${TEMPLATE_VERSION}"`)
  })

  it('produces a different render key per voice and template version', async () => {
    expect(await keyFor('en-US-AriaNeural')).not.toBe(await keyFor('en-GB-RyanNeural'))
    const a = await keyFor()
    const b = await renderKey({
      itemId: ITEM_ID,
      contentHash: 'hash',
      promptVersion: 'p1',
      templateVersion: `${TEMPLATE_VERSION}-next`,
      voice: 'en-US-AriaNeural',
    })
    expect(a).not.toBe(b)
  })
})
