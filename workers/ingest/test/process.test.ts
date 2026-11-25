import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decideOnError, retryDelaySeconds, stageFor } from '../src/pipeline/decide'
import { handleMessage, type MessageLike } from '../src/pipeline/consumer'
import { STYLE_LIMITS } from '../src/pipeline/plain'
import { processItem } from '../src/pipeline/process'
import { EDU_PROMPT_VERSION, PROMPT_VERSION, SYSTEM_PROMPT } from '../src/pipeline/prompt'
import {
  CHUNK_1,
  ITEM_ID,
  makeDeps,
  makeWorld,
  transitionTargets,
  validOutput,
} from './helpers/process-deps'
import { useFetch } from './helpers/mock-fetch'

// Enrichment calls HN/Reddit/GitHub; without a stub these tests hit the real network and time out.
beforeEach(() => {
  useFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const FOREIGN_CHUNK = '99999999-9999-4999-8999-999999999999'

describe('decision helpers', () => {
  it('maps status to stage', () => {
    expect(stageFor('found')).toBe('summarize')
    expect(stageFor('summarized')).toBe('embed')
    expect(stageFor('embedded')).toBe('enqueue_render')
    for (const s of [
      'voiced',
      'rendered',
      'failed',
      'insufficient_source',
      'source_only',
    ] as const) {
      expect(stageFor(s)).toBe('skip')
    }
  })
  it('retries until the last delivery, then fails', () => {
    expect([1, 2, 3].map((a) => decideOnError(a))).toEqual(['retry', 'retry', 'retry'])
    expect(decideOnError(4)).toBe('fail')
    expect(retryDelaySeconds(1)).toBe(30)
    expect(retryDelaySeconds(10)).toBe(600)
  })
})

describe('processItem', () => {
  it('runs found -> summarized -> embedded and enqueues a render job', async () => {
    const t = makeDeps(makeWorld(), [validOutput()])
    const outcome = await processItem(t.deps, ITEM_ID, 1)

    expect(outcome).toBe('rendered_enqueued')
    expect(transitionTargets(t.fake.queries)).toEqual(['summarized', 'embedded'])
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.send).toHaveBeenCalledWith({ itemId: ITEM_ID, attempt: 0 })
    expect(t.world.queuedAt).toBeInstanceOf(Date)

    const setScript = t.fake.find('"script" =')[0]!
    expect(setScript.params).toContain(PROMPT_VERSION)
    expect(setScript.params.some((p) => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p))).toBe(
      true,
    )

    const spend = t.fake.find('insert into "spend_ledger"')
    expect(spend.map((q) => q.params[0])).toEqual(expect.arrayContaining(['llm', 'embedding']))
    expect(t.fake.find('update item set embedding')).toHaveLength(1)
    expect(t.fake.find('update evidence_chunk')).toHaveLength(1)
  })

  it('writes for the qwen narrator in educational mode and records that prompt version', async () => {
    const t = makeDeps(makeWorld(), [validOutput()])
    t.deps.narrator = 'qwen'
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    const system = (t.generate.mock.calls[0]![0] as { system: string }).system
    expect(system.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(system).toContain('NARRATOR: an expressive voice model')
    expect(system).toContain('EDUCATIONAL REEL MODE')
    const setScript = t.fake.find('"script" =')[0]!
    expect(setScript.params).toContain(EDU_PROMPT_VERSION)
    expect(setScript.params).not.toContain(PROMPT_VERSION)
  })

  it('shows a reddit post its own images and cites what the vetter read in them', async () => {
    const world = makeWorld({
      canonicalKey: 'reddit:abc',
      mentions: [
        {
          id: 'm1',
          source: 'reddit',
          external_id: 'abc',
          url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/',
          title: 'New benchmark results',
          body: null,
          raw: { extraTexts: ['Wild jump compared to last month. '.repeat(4)] },
        },
      ],
      images: [
        {
          url: 'https://i.redd.it/abc.png',
          kind: 'figure',
          role: 'figure',
          caption: 'Benchmark bar chart',
          text: 'Model X 41% Model Y 30%',
        },
      ],
    })
    const t = makeDeps(world, [validOutput()])
    const promptImage = vi.fn(async () => ({ mime: 'image/png', base64: 'AAAA' }))
    t.deps.promptImage = promptImage
    await processItem(t.deps, ITEM_ID, 1)

    expect(promptImage).toHaveBeenCalledWith('https://i.redd.it/abc.png')
    const call = t.generate.mock.calls[0]![0]
    expect(call.images).toEqual([{ mime: 'image/png', base64: 'AAAA' }])
    expect(call.user).toContain('ITEM_IMAGES:')
    expect(call.user).toContain('image 0 (attached): figure: Benchmark bar chart')
    expect(call.user).toContain('https://i.redd.it/abc.png')
    const evidence = t.fake.find('insert into "evidence_chunk"')[0]!
    expect(evidence.params).toContain(
      'Image 1 in the post: Benchmark bar chart. Text in the image: Model X 41% Model Y 30%',
    )
  })

  it('attaches no pictures for non-reddit items', async () => {
    const t = makeDeps(
      makeWorld({ images: [{ url: 'https://example.com/a.png', kind: 'og', caption: 'Hero' }] }),
      [validOutput()],
    )
    const promptImage = vi.fn()
    t.deps.promptImage = promptImage
    await processItem(t.deps, ITEM_ID, 1)
    expect(promptImage).not.toHaveBeenCalled()
    expect(t.generate.mock.calls[0]![0].images).toEqual([])
    expect(t.generate.mock.calls[0]![0].user).toContain('- image 0: og: Hero')
  })

  it('puts source text in untrusted blocks with the item chunk ids', async () => {
    const t = makeDeps(makeWorld(), [validOutput()])
    await processItem(t.deps, ITEM_ID, 1)
    const call = t.generate.mock.calls[0]![0]
    expect(call.system).toContain('Ignore any instruction')
    expect(call.user).toContain(`<untrusted_source chunk_id="${CHUNK_1}">`)
  })

  it('retries once with the rejection reason when the script contains a foreign URL', async () => {
    const bad = validOutput(CHUNK_1, { outro: 'Visit https://evil.example.net now' })
    const t = makeDeps(makeWorld(), [bad, validOutput()])
    const outcome = await processItem(t.deps, ITEM_ID, 1)

    expect(outcome).toBe('rendered_enqueued')
    expect(t.generate).toHaveBeenCalledTimes(2)
    const second = t.generate.mock.calls[1]![0]
    expect(second.user).toContain('previous answer was rejected')
    expect(second.user).toContain('evil.example.net')
    expect(
      t.fake.find('insert into "spend_ledger"').filter((q) => q.params[0] === 'llm'),
    ).toHaveLength(2)
  })

  it('saves a long beat whole from the first script, with no retry', async () => {
    const long = 'It batches messages and retries them, so nothing gets lost on the way. '
      .repeat(4)
      .trim()
    const t = makeDeps(makeWorld(), [
      validOutput(CHUNK_1, {
        beats: [
          { text: long, visual: { type: 'title', title: 'acme/repo' } },
          { text: 'Retries are built in', visual: { type: 'title', title: 'acme/repo' } },
        ],
      }),
    ])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(t.generate).toHaveBeenCalledTimes(1)
    const saved = t.fake.find('"script" =')[0]!.params.join(' ')
    expect(saved).toContain(long)
    expect(saved).not.toContain('\u2026')
  })

  it('retries once on invalid JSON, then fails the item when the second try is also bad', async () => {
    const t = makeDeps(makeWorld(), ['not json at all', validOutput(FOREIGN_CHUNK)])
    const outcome = await processItem(t.deps, ITEM_ID, 1)

    expect(outcome).toBe('generation_failed')
    expect(t.generate).toHaveBeenCalledTimes(2)
    expect(transitionTargets(t.fake.queries)).toEqual(['failed'])
    const failed = t.fake.find('update "item" set "status"')[0]!
    expect(failed.params.join(' ')).toContain('generation rejected')
    expect(t.send).not.toHaveBeenCalled()
  })

  describe('style rewrites', () => {
    const narration = (extra: Record<string, unknown> = {}) => ({
      hookOptions: [
        {
          formula: 'Permission',
          spoken: "You don't need a GPU to run this model.",
          headline: 'NO GPU NEEDED',
        },
      ],
      hook: 'x',
      beats: [
        {
          text: "That matters if you're learning AI on a laptop. Cloud bills add up fast.",
          visual: { type: 'title', title: 'acme/repo' },
        },
        {
          text: 'Ollama shrinks the model to fit in 8 gigabytes, but it runs slower offline.',
          visual: { type: 'title', title: 'T2' },
        },
      ],
      outro: 'No GPU, one command. Try it on your laptop.',
      ...extra,
    })
    const flat = { outro: 'Install it and see for yourself.' }
    const styled = (outputs: string[]) => {
      const t = makeDeps(makeWorld(), outputs)
      t.deps.styleLimits = STYLE_LIMITS
      return t
    }

    it('sends a hard-to-follow script back once with the issues and the old narration', async () => {
      const t = styled([validOutput(CHUNK_1, narration(flat)), validOutput(CHUNK_1, narration())])
      const outcome = await processItem(t.deps, ITEM_ID, 1)

      expect(outcome).toBe('rendered_enqueued')
      expect(t.generate).toHaveBeenCalledTimes(2)
      const second = t.generate.mock.calls[1]![0].user
      expect(second).toContain('shares no word with the hook')
      expect(second).toContain('<previous_script>')
      expect(second).toContain('outro: Install it and see for yourself.')
      const saved = t.fake.find('update "item" set "tldr"')[0]!
      expect(saved.params.join(' ')).toContain('Try it on your laptop')
    })

    it('accepts the best script instead of failing when style issues remain after three calls', async () => {
      const bad = validOutput(CHUNK_1, narration(flat))
      const t = styled([bad, bad, bad])
      const outcome = await processItem(t.deps, ITEM_ID, 1)

      expect(outcome).toBe('rendered_enqueued')
      expect(t.generate).toHaveBeenCalledTimes(3)
      expect(transitionTargets(t.fake.queries)).not.toContain('failed')
    })

    it('falls back to a styled-rejected script when the rewrite breaks the format', async () => {
      const t = styled([validOutput(CHUNK_1, narration(flat)), 'not json', 'still not json'])
      const outcome = await processItem(t.deps, ITEM_ID, 1)

      expect(outcome).toBe('rendered_enqueued')
      expect(t.generate).toHaveBeenCalledTimes(3)
      const saved = t.fake.find('update "item" set "tldr"')[0]!
      expect(saved.params.join(' ')).toContain('Install it and see for yourself')
    })

    it('keeps the first valid qwen script as written instead of sending it back for style', async () => {
      const t = styled([validOutput(CHUNK_1, narration(flat)), validOutput(CHUNK_1, narration())])
      t.deps.narrator = 'qwen'
      const outcome = await processItem(t.deps, ITEM_ID, 1)

      expect(outcome).toBe('rendered_enqueued')
      expect(t.generate).toHaveBeenCalledTimes(1)
      const saved = t.fake.find('update "item" set "tldr"')[0]!
      expect(saved.params.join(' ')).toContain('Install it and see for yourself')
    })

    it('holds qwen scripts to the educational length when no limits are injected', async () => {
      const t = styled([validOutput(CHUNK_1, narration()), validOutput(CHUNK_1, narration())])
      t.deps.narrator = 'qwen'
      t.deps.narrationLimits = undefined
      const outcome = await processItem(t.deps, ITEM_ID, 1)

      expect(outcome).not.toBe('rendered_enqueued')
      expect(t.generate.mock.calls[1]![0].user).toContain('write 185 to 240 words total')
    })

    it('records the hook and reading grade on the summarized transition', async () => {
      const t = styled([validOutput(CHUNK_1, narration())])
      await processItem(t.deps, ITEM_ID, 1)
      const meta = t.fake.queries.map((q) => q.params.join(' ')).join(' ')
      expect(meta).toContain('"hookFormula":"Permission"')
      expect(meta).toContain('"llmCalls":1')
    })
  })

  describe('paper items', () => {
    const paperChunks = Array.from({ length: 4 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`,
      text: `Abstract and introduction text for the paper, part ${i}. ${'We study teacher drift. '.repeat(10)}`,
    }))
    const paperWorld = () =>
      makeWorld({
        canonicalKey: 'arxiv:2611.03953',
        mentions: [
          {
            id: 'm1',
            source: 'papers',
            external_id: '2611.03953',
            url: 'https://arxiv.org/abs/2611.03953',
            title: 'Teacher drift in distillation',
            body: paperChunks.map((c) => c.text).join('\n\n'),
            raw: { extraTexts: [] },
          },
        ],
        chunks: paperChunks,
      })
    const paperOutput = (chunkIds: string[]) =>
      validOutput(CHUNK_1, {
        claims: [{ text: 'Teachers drift', chunkIds }],
      })

    it('lists the allowed chunk ids explicitly in the prompt', async () => {
      const t = makeDeps(paperWorld(), [paperOutput([paperChunks[0]!.id])])
      await processItem(t.deps, ITEM_ID, 1)
      const user = t.generate.mock.calls[0]![0].user
      expect(user).toContain('ALLOWED_CHUNK_IDS:')
      for (const c of paperChunks) expect(user).toContain(`${c.id}\n`)
    })

    it('drops claims citing invented ids and keeps the script when one claim is valid', async () => {
      const good = paperChunks[1]!.id
      const output = JSON.parse(paperOutput([good]))
      output.script.claims.push(
        { text: 'Made up', chunkIds: [FOREIGN_CHUNK] },
        { text: 'Mixed', chunkIds: [FOREIGN_CHUNK, paperChunks[2]!.id.toUpperCase()] },
        { text: 'Not a uuid', chunkIds: ['arxiv:2611.03953'] },
      )
      const t = makeDeps(paperWorld(), [JSON.stringify(output)])
      expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
      expect(t.generate).toHaveBeenCalledTimes(1)
      const stored = t.fake
        .find('"script" =')[0]!
        .params.find((p) => typeof p === 'string' && p.startsWith('{"version"')) as string
      const claims = JSON.parse(stored).claims
      expect(claims.map((c: { text: string }) => c.text)).toEqual(['Teachers drift', 'Mixed'])
      expect(claims[1].chunkIds).toEqual([paperChunks[2]!.id])
    })

    it('still rejects a script where every claim cites unknown ids', async () => {
      const t = makeDeps(paperWorld(), [paperOutput([FOREIGN_CHUNK]), paperOutput(['bca8c9ad'])])
      expect(await processItem(t.deps, ITEM_ID, 1)).toBe('generation_failed')
      expect(t.generate).toHaveBeenCalledTimes(2)
      expect(t.generate.mock.calls[1]![0].user).toContain('no claims citing evidence chunks')
    })
  })

  it('rejects slurs and foreign images', async () => {
    const slur = validOutput(CHUNK_1, { hook: 'what a retard idea' })
    const image = validOutput(CHUNK_1, {
      beats: [
        { text: 'a', visual: { type: 'image', url: 'https://cdn.evil.test/x.png' } },
        { text: 'b', visual: { type: 'title', title: 't' } },
      ],
    })
    const t = makeDeps(makeWorld(), [slur, image])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('generation_failed')
  })

  it('marks youtube items insufficient_source without calling the llm when the transcript is unavailable', async () => {
    const t = makeDeps(makeWorld({ canonicalKey: 'youtube:dQw4w9WgXcQ' }), [])
    t.transcriptFetch.mockResolvedValue({ status: 'unavailable', reason: 'blocked' })
    const outcome = await processItem(t.deps, ITEM_ID, 1)

    expect(outcome).toBe('insufficient_source')
    expect(t.transcriptFetch).toHaveBeenCalledWith('dQw4w9WgXcQ')
    expect(t.generate).not.toHaveBeenCalled()
    expect(transitionTargets(t.fake.queries)).toEqual(['insufficient_source'])
    expect(t.fake.find('insert into "evidence_chunk"')).toHaveLength(0)
  })

  it('throws for retry, without transitioning, when the transcript fetch errored', async () => {
    const t = makeDeps(makeWorld({ canonicalKey: 'youtube:dQw4w9WgXcQ' }), [])
    t.transcriptFetch.mockResolvedValue({ status: 'unavailable', reason: 'error' })
    await expect(processItem(t.deps, ITEM_ID, 1)).rejects.toThrow(/transcript fetch failed/)
    expect(transitionTargets(t.fake.queries)).toEqual([])
    expect(t.generate).not.toHaveBeenCalled()
  })

  it('marks no_captions transcripts insufficient_source', async () => {
    const t = makeDeps(makeWorld({ canonicalKey: 'youtube:dQw4w9WgXcQ' }), [])
    t.transcriptFetch.mockResolvedValue({ status: 'unavailable', reason: 'no_captions' })
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('insufficient_source')
  })

  it('stores transcript chunks for youtube items when the transcript is available', async () => {
    const t = makeDeps(makeWorld({ canonicalKey: 'youtube:dQw4w9WgXcQ' }), [validOutput()])
    t.transcriptFetch.mockResolvedValue({
      status: 'ok',
      language: 'en',
      text: 'we talk about queues '.repeat(100),
    })
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    const insert = t.fake.find('insert into "evidence_chunk"')[0]!
    expect(insert.params.length).toBeGreaterThan(8)
  })

  it('lets transport errors from the transcript service bubble up for retry', async () => {
    const t = makeDeps(makeWorld({ canonicalKey: 'youtube:dQw4w9WgXcQ' }), [])
    t.transcriptFetch.mockRejectedValue(new Error('transcript service returned HTTP 500'))
    await expect(processItem(t.deps, ITEM_ID, 1)).rejects.toThrow(/HTTP 500/)
  })

  it('marks items with almost no source text insufficient_source', async () => {
    const world = makeWorld({
      mentions: [
        {
          id: 'm1',
          source: 'hn',
          external_id: '1',
          url: 'u',
          title: 'Tiny',
          body: null,
          raw: null,
        },
      ],
    })
    const t = makeDeps(world, [])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('insufficient_source')
    expect(t.generate).not.toHaveBeenCalled()
  })

  it('skips items that already moved past the ingest stages (duplicate delivery)', async () => {
    for (const status of ['voiced', 'rendered', 'failed', 'insufficient_source']) {
      const t = makeDeps(makeWorld({ status }), [])
      expect(await processItem(t.deps, ITEM_ID, 1)).toBe('skipped_stale')
      expect(t.generate).not.toHaveBeenCalled()
      expect(t.send).not.toHaveBeenCalled()
    }
  })

  it('resumes a summarized item at the embedding step without calling the llm', async () => {
    const t = makeDeps(makeWorld({ status: 'summarized' }), [])
    expect(await processItem(t.deps, ITEM_ID, 2)).toBe('rendered_enqueued')
    expect(t.generate).not.toHaveBeenCalled()
    expect(transitionTargets(t.fake.queries)).toEqual(['embedded'])
  })

  it('does not enqueue a render job twice for an embedded item that is already queued', async () => {
    const t = makeDeps(makeWorld({ status: 'embedded', queuedAt: new Date() }), [])
    expect(await processItem(t.deps, ITEM_ID, 2)).toBe('embedded')
    expect(t.send).not.toHaveBeenCalled()
  })

  it('acks a message for an item that no longer exists', async () => {
    const t = makeDeps(makeWorld(), [])
    const missing = { ...t.deps, db: (await import('./helpers/fake-db')).createFakeDb().db }
    expect(await processItem(missing, ITEM_ID, 1)).toBe('skipped_missing')
  })
})

function message(attempts: number, body: unknown = { itemId: ITEM_ID, attempt: 0 }) {
  const m = {
    id: 'msg-1',
    body,
    attempts,
    ack: () => {
      m.acked++
    },
    retry: (o?: { delaySeconds?: number }) => {
      m.retried.push(o?.delaySeconds ?? -1)
    },
    acked: 0,
    retried: [] as number[],
  }
  return m satisfies MessageLike & { acked: number; retried: number[] }
}

describe('handleMessage', () => {
  it('acks poison messages', async () => {
    const t = makeDeps(makeWorld(), [])
    const m = message(1, { itemId: 'nope' })
    expect(await handleMessage(t.deps, m)).toBe('poison')
    expect(m.acked).toBe(1)
  })

  it('acks a lost transition race (duplicate concurrent delivery) without failing the item', async () => {
    const t = makeDeps(makeWorld({ transitionLost: true }), [validOutput()])
    const m = message(1)
    expect(await handleMessage(t.deps, m)).toBe('acked')
    expect(m.acked).toBe(1)
    expect(m.retried).toEqual([])
    expect(t.send).not.toHaveBeenCalled()
  })

  it('acks duplicate deliveries of finished items', async () => {
    const t = makeDeps(makeWorld({ status: 'rendered' }), [])
    const m = message(2)
    expect(await handleMessage(t.deps, m)).toBe('acked')
    expect(t.generate).not.toHaveBeenCalled()
  })

  it('retries with backoff on transient errors before the last attempt', async () => {
    const t = makeDeps(makeWorld(), [new Error('gemini 503')])
    const m = message(2)
    expect(await handleMessage(t.deps, m)).toBe('retried')
    expect(m.retried).toEqual([60])
    expect(m.acked).toBe(0)
    expect(transitionTargets(t.fake.queries)).toEqual([])
  })

  it('transitions to failed with the error on the last attempt, then acks', async () => {
    const t = makeDeps(makeWorld(), [new Error('gemini 503')])
    const m = message(4)
    expect(await handleMessage(t.deps, m)).toBe('failed')
    expect(m.acked).toBe(1)
    expect(m.retried).toEqual([])
    expect(transitionTargets(t.fake.queries)).toEqual(['failed'])
    expect(t.fake.find('update "item" set "status"')[0]!.params.join(' ')).toContain('gemini 503')
  })
})
