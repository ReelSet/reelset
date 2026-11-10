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
import type { AiLike } from './tts'

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

  it('forwards facts, headline and shots to the container', async () => {
    const script = {
      ...(makeItem().script as object),
      headline: 'Stars are exploding',
      beats: [
        {
          text: 'Beat one.',
          visual: { type: 'title', title: 'One' },
          shots: [{ at: 'beat', show: 'StatSlam', props: { value: '1,200', label: 'stars' } }],
        },
        { text: 'Beat two.', visual: { type: 'title', title: 'Two' } },
      ],
    }
    const facts = { repo: { owner: 'acme', name: 'widget', stars: 1200, forks: 40 } }
    const store = new FakeStore(makeItem({ script, facts }))
    const { deps, containers } = setup({ store })

    await processRenderJob(deps, body, 1)

    const sent = containers[0]!.requests[0]!.body as {
      script: { headline: string; beats: { shots?: { show: string }[] }[] }
      facts: unknown
    }
    expect(sent.facts).toEqual(facts)
    expect(sent.script.headline).toBe('Stars are exploding')
    expect(sent.script.beats[0]!.shots?.[0]?.show).toBe('StatSlam')
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

function speakingAi(ends: number[] = [1]) {
  let spoken = ''
  let novaCalls = 0
  return {
    async run(model: string, input: Record<string, unknown>): Promise<unknown> {
      if (model.includes('aura')) {
        spoken = String(input.text)
        return new Uint8Array([1, 2, 3])
      }
      const end = ends[Math.min(novaCalls++, ends.length - 1)]!
      const tokens = spoken.split(/\s+/).filter(Boolean)
      const step = end / tokens.length
      const words = tokens.map((word, i) => ({ word, start: i * step, end: (i + 1) * step }))
      return { results: { channels: [{ alternatives: [{ words }] }] } }
    },
    get novaCalls() {
      return novaCalls
    },
  }
}

describe('aura-2 narration', () => {
  const okAi = speakingAi()
  const brokenAi = {
    async run(): Promise<unknown> {
      throw new Error('down')
    },
  }

  it('sends audio and word timings to the container and records priced tts spend', async () => {
    const { deps, containers, rec } = setup()
    deps.voice = 'aura2-hera'
    deps.edgeVoice = 'en-US-AriaNeural'
    deps.aura = { ai: okAi, speaker: 'hera' }
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    const sent = containers[0]!.requests[0]!.body as Record<string, any>
    expect(sent.voice).toBe('aura2-hera')
    expect(sent.narration.audioBase64).toBe('AQID')
    expect(sent.narration.words[0].text).toBe('Hook')
    const tts = rec.spends.find((s) => s.category === 'tts')!
    expect(tts.costUsd).toBeGreaterThan(0)
    expect(tts.meta).toMatchObject({ provider: 'aura2' })
  })

  const longScript = {
    version: 1,
    hook: 'Hook line.',
    beats: [
      {
        text: 'First point here. Second point follows. Third point ends.',
        visual: { type: 'title', title: 'One' },
        shots: [{ at: 'third', show: 'KeyPoint' }],
      },
      { text: 'Beat two is short.', visual: { type: 'title', title: 'Two' } },
    ],
    outro: 'Outro line.',
    claims: [],
  }
  it('re-synthesizes once from a shortened script when aura runs past 58s', async () => {
    const { deps, containers, rec } = setup({
      store: new FakeStore(makeItem({ script: longScript })),
    })
    deps.voice = 'aura2-hera'
    const ai = speakingAi([66, 52])
    deps.aura = { ai, speaker: 'hera' }
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    const sent = containers[0]!.requests[0]!.body as Record<string, any>
    expect(ai.novaCalls).toBe(2)
    expect(sent.narration).toBeDefined()
    expect(sent.voice).toBe('aura2-hera')
    expect(sent.script.beats[0].text).not.toContain('Third point')
    expect(sent.script.beats[0].shots).toEqual([])
    const tts = rec.spends.find((s) => s.category === 'tts')!
    expect(tts.meta).toMatchObject({ provider: 'aura2' })
    expect(tts.costUsd).toBeGreaterThan(0)
  })

  it('falls back to edge-tts when the shortened narration is still over the cap', async () => {
    const { deps, containers } = setup({
      store: new FakeStore(makeItem({ script: longScript })),
    })
    deps.voice = 'aura2-hera'
    deps.edgeVoice = 'en-US-AriaNeural'
    const ai = speakingAi([70, 64])
    deps.aura = { ai, speaker: 'hera' }
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    const sent = containers[0]!.requests[0]!.body as Record<string, any>
    expect(ai.novaCalls).toBe(2)
    expect(sent.narration).toBeUndefined()
    expect(sent.voice).toBe('en-US-AriaNeural')
    expect(sent.script.beats[0].text).toContain('Third point')
  })

  it('goes straight to edge-tts when nothing can be shortened', async () => {
    const { deps, containers } = setup()
    deps.edgeVoice = 'en-US-AriaNeural'
    const ai = speakingAi([70])
    deps.aura = { ai, speaker: 'hera' }
    expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
    expect(ai.novaCalls).toBe(1)
    expect((containers[0]!.requests[0]!.body as Record<string, any>).narration).toBeUndefined()
  })

  describe('kokoro fallback', () => {
    const renderBody = (ttsProvider: string) => ({
      jobId: 'x',
      bytes: 1000,
      posterBytes: 50,
      durationMs: 30_000,
      ttsDurationMs: 29_000,
      ttsChars: 400,
      ttsProvider,
      renderMs: 20_000,
      cover: true,
      templateVersion: TEMPLATE_VERSION,
    })
    const withKokoro = (provider: string, ai: unknown) => {
      const containers = [new FakeContainer({ renderBody: renderBody(provider) })]
      const ctx = setup({ containers })
      ctx.deps.voice = 'aura2-hera'
      ctx.deps.edgeVoice = 'en-US-AriaNeural'
      ctx.deps.fallbackEngine = 'kokoro'
      ctx.deps.aura = { ai: ai as AiLike, speaker: 'hera' }
      return ctx
    }
    const sentBody = (c: FakeContainer) => c.requests[0]!.body as Record<string, any>

    it('keeps aura as primary and asks for no container engine', async () => {
      const { deps, containers } = withKokoro('supplied', okAi)
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(sentBody(containers[0]!).narration).toBeDefined()
      expect(sentBody(containers[0]!).ttsEngine).toBeUndefined()
    })

    it('goes to kokoro on the first delivery when aura fails', async () => {
      const { deps, containers, rec } = withKokoro('kokoro', brokenAi)
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      const sent = sentBody(containers[0]!)
      expect(sent.narration).toBeUndefined()
      expect(sent.ttsEngine).toBe('kokoro')
      expect(sent.voice).toBe('en-US-AriaNeural')
      expect(rec.spends.find((s) => s.category === 'tts')).toMatchObject({
        costUsd: 0,
        meta: { provider: 'kokoro' },
      })
    })

    it('goes to kokoro when nova fails after aura succeeded', async () => {
      const novaDown = {
        async run(model: string): Promise<unknown> {
          if (model.includes('aura')) return new Uint8Array([1, 2, 3])
          throw new Error('nova down')
        },
      }
      const { deps, containers, rec } = withKokoro('kokoro', novaDown)
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(sentBody(containers[0]!).narration).toBeUndefined()
      expect(sentBody(containers[0]!).ttsEngine).toBe('kokoro')
      expect(rec.spends.find((s) => s.category === 'tts')!.meta).toMatchObject({
        provider: 'kokoro',
      })
    })

    it('goes to kokoro when the alignment is unusable', async () => {
      const noWords = {
        async run(model: string): Promise<unknown> {
          return model.includes('aura')
            ? new Uint8Array([1, 2, 3])
            : { results: { channels: [{ alternatives: [{ words: [] }] }] } }
        },
      }
      const { deps, containers } = withKokoro('kokoro', noWords)
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(sentBody(containers[0]!).narration).toBeUndefined()
      expect(sentBody(containers[0]!).ttsEngine).toBe('kokoro')
    })

    it('records edge when kokoro itself failed inside the container', async () => {
      const { deps, rec } = withKokoro('edge', brokenAi)
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(rec.spends.find((s) => s.category === 'tts')!.meta).toMatchObject({ provider: 'edge' })
    })

    it('asks for kokoro straight away when aura is not configured', async () => {
      const containers = [new FakeContainer({ renderBody: renderBody('kokoro') })]
      const { deps } = setup({ containers })
      deps.fallbackEngine = 'kokoro'
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(sentBody(containers[0]!).ttsEngine).toBe('kokoro')
    })

    it('defaults to edge when nothing selects an engine', async () => {
      const { deps, containers } = setup()
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect(sentBody(containers[0]!).ttsEngine).toBe('edge')
    })
  })

  describe('stock b-roll and demo', () => {
    const pick = {
      url: 'https://videos.pexels.com/a.mp4',
      id: 1,
      beat: 1,
      seconds: 5,
      creator: 'Ann',
      creatorUrl: 'https://www.pexels.com/@ann',
      pageUrl: 'https://www.pexels.com/video/1/',
    }

    it('sends clips and the demo to the container and stores the returned credits', async () => {
      const container = new FakeContainer({
        renderBody: {
          jobId: 'x',
          bytes: 1000,
          posterBytes: 50,
          durationMs: 30_000,
          ttsDurationMs: 29_000,
          ttsChars: 400,
          renderMs: 20_000,
          cover: true,
          templateVersion: TEMPLATE_VERSION,
          credits: [{ kind: 'stock', provider: 'pexels', creator: 'Ann', url: pick.pageUrl }],
        },
      })
      const store = new FakeStore()
      store.item = makeItem({
        demo: {
          url: 'https://github.com/user-attachments/assets/x',
          kind: 'mp4',
          repo: 'acme/widget',
        },
      })
      const { deps } = setup({ store, containers: [container] })
      deps.broll = async () => [pick]
      await processRenderJob(deps, body, 1)
      const call = container.requests[0]!.body as Record<string, unknown>
      expect(call.broll).toEqual([pick])
      expect(call.demo).toMatchObject({ kind: 'mp4', repo: 'acme/widget' })
      const key = await keyFor()
      expect(store.renders.get(key)?.done?.credits).toEqual([
        { kind: 'stock', provider: 'pexels', creator: 'Ann', url: pick.pageUrl },
      ])
    })

    it('still renders when the b-roll lookup throws', async () => {
      const { deps, containers } = setup()
      deps.broll = async () => {
        throw new Error('pexels down')
      }
      expect(await processRenderJob(deps, body, 1)).toEqual({ action: 'ack' })
      expect((containers[0]!.requests[0]!.body as Record<string, unknown>).broll).toBeUndefined()
    })
  })
})
