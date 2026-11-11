import { createLogger } from '@reelset/core'
import { describe, expect, it, vi } from 'vitest'
import type { EvidenceChunk } from './evidence'
import { ClaudeError, ClaudeRefusalError } from './claude'
import { GeminiError } from './gemini'
import {
  AI_UNAVAILABLE_MESSAGE,
  NO_EVIDENCE_MESSAGE,
  runAsk,
  type AskDeps,
  type AskLogEntry,
} from './service'

const log = createLogger({ app: 'test', level: 'silent' })
const check = { ok: true as const, question: 'Is Bun faster?', normalized: 'is bun faster' }
const input = { profileId: 'p1', check }

const evidence = (id: string, similarity = 0.8): EvidenceChunk => ({
  id,
  itemId: `i-${id}`,
  text: 'text',
  title: `T ${id}`,
  url: `https://x.test/${id}`,
  publishedAt: '2026-11-01T00:00:00.000Z',
  similarity,
})

function makeDeps(overrides: Partial<AskDeps> = {}) {
  const logged: AskLogEntry[] = []
  const deps: AskDeps = {
    log,
    limits: async () => ({ hourlyLimit: 20, dailyCapUsd: 5 }),
    spentTodayUsd: async () => 0,
    reserveAsk: async () => 'res-1',
    findCached: vi.fn(async () => null),
    embed: vi.fn(async () => new Array(768).fill(0)),
    retrieve: vi.fn(async () => [evidence('a'), evidence('b')]),
    generate: vi.fn(async () => ({
      text: '',
      model: 'claude-haiku-5-5' as const,
      inputTokens: 100,
      outputTokens: 20,
      parsed: { answer: 'Yes, mostly.', citations: ['a', 'ghost'] },
    })),
    recordSpend: vi.fn(async () => undefined),
    logQuery: async (entry) => {
      logged.push(entry)
    },
    completeQuery: async (_id, entry) => {
      logged.push(entry)
    },
    ...overrides,
  }
  return { deps, logged }
}

describe('runAsk', () => {
  it('answers with only citations from the retrieved set and records spend', async () => {
    const { deps, logged } = makeDeps()
    const result = await runAsk(deps, input)
    expect(result).toMatchObject({ outcome: 'answered', answer: 'Yes, mostly.', cached: false })
    if (result.outcome === 'answered') expect(result.citations.map((c) => c.chunkId)).toEqual(['a'])
    expect(deps.recordSpend).toHaveBeenCalledWith(
      'embedding',
      expect.any(Number),
      expect.any(Number),
    )
    expect(deps.recordSpend).toHaveBeenCalledWith(
      'llm',
      120,
      expect.any(Number),
      'claude-haiku-5-5',
    )
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ outcome: 'answered', inputTokens: 100, outputTokens: 20 })
  })

  it('rate limits before touching cache, embeddings or the model', async () => {
    const { deps, logged } = makeDeps({ reserveAsk: async () => null })
    const result = await runAsk(deps, input)
    expect(result.outcome).toBe('rate_limited')
    expect(deps.findCached).not.toHaveBeenCalled()
    expect(deps.embed).not.toHaveBeenCalled()
    expect(logged[0]?.outcome).toBe('rate_limited')
  })

  it('stops at the daily spend cap without reserving a rate-limit slot', async () => {
    const reserveAsk = vi.fn(async () => 'res-1')
    const { deps } = makeDeps({ spentTodayUsd: async () => 5, reserveAsk })
    expect((await runAsk(deps, input)).outcome).toBe('spend_capped')
    expect(reserveAsk).not.toHaveBeenCalled()
    expect(deps.embed).not.toHaveBeenCalled()
  })

  it('lets only hourlyLimit of many concurrent requests through', async () => {
    let used = 0
    const hourlyLimit = 2
    const reserveAsk = vi.fn(async () => {
      await Promise.resolve()
      if (used >= hourlyLimit) return null
      used++
      return `res-${used}`
    })
    const { deps } = makeDeps({ reserveAsk, limits: async () => ({ hourlyLimit, dailyCapUsd: 5 }) })
    const results = await Promise.all(Array.from({ length: 6 }, () => runAsk(deps, input)))
    expect(results.filter((r) => r.outcome === 'answered')).toHaveLength(2)
    expect(results.filter((r) => r.outcome === 'rate_limited')).toHaveLength(4)
  })

  it('completes the reserved row instead of inserting a second one', async () => {
    const completeQuery = vi.fn(async () => undefined)
    const logQuery = vi.fn(async () => undefined)
    const { deps } = makeDeps({ completeQuery, logQuery })
    await runAsk(deps, input)
    expect(completeQuery).toHaveBeenCalledWith(
      'res-1',
      expect.objectContaining({ outcome: 'answered' }),
    )
    expect(logQuery).not.toHaveBeenCalled()
  })

  it('forwards streamed text to the caller', async () => {
    const { deps } = makeDeps({
      generate: vi.fn(async (_q, _c, onText) => {
        onText('Yes, ')
        onText('mostly.')
        return {
          text: '',
          model: 'claude-haiku-5-5' as const,
          inputTokens: 1,
          outputTokens: 1,
          parsed: { answer: 'Yes, mostly.', citations: ['a'] },
        }
      }),
    })
    const deltas: string[] = []
    await runAsk(deps, input, (t) => deltas.push(t))
    expect(deltas).toEqual(['Yes, ', 'mostly.'])
  })

  it('serves the cache without calling the providers and logs it as cached with its answer', async () => {
    const cached = { answer: 'cached', citations: [] }
    const { deps, logged } = makeDeps({ findCached: vi.fn(async () => cached) })
    const result = await runAsk(deps, input)
    expect(result).toMatchObject({ outcome: 'answered', answer: 'cached', cached: true })
    expect(deps.embed).not.toHaveBeenCalled()
    expect(logged[0]).toMatchObject({ outcome: 'answered', answer: 'cached', cached: true })
  })

  it('answers no_evidence when nothing clears the similarity threshold', async () => {
    const { deps } = makeDeps({ retrieve: vi.fn(async () => [evidence('a', 0.2)]) })
    const result = await runAsk(deps, input)
    expect(result).toEqual({ outcome: 'no_evidence', message: NO_EVIDENCE_MESSAGE })
    expect(deps.generate).not.toHaveBeenCalled()
  })

  it('treats an answer with no valid citation as no_evidence', async () => {
    const { deps } = makeDeps({
      generate: vi.fn(async () => ({
        text: '',
        model: 'claude-haiku-5-5' as const,
        inputTokens: 1,
        outputTokens: 1,
        parsed: { answer: 'Made up', citations: ['ghost'] },
      })),
    })
    expect((await runAsk(deps, input)).outcome).toBe('no_evidence')
  })

  it('returns error when the model output is not valid JSON', async () => {
    const { deps, logged } = makeDeps({
      generate: vi.fn(async () => ({
        text: 'x',
        model: 'claude-haiku-5-5' as const,
        inputTokens: 1,
        outputTokens: 1,
        parsed: null,
      })),
    })
    expect((await runAsk(deps, input)).outcome).toBe('error')
    expect(logged[0]?.outcome).toBe('error')
  })

  it('returns error and still logs when embedding throws', async () => {
    const { deps, logged } = makeDeps({
      embed: vi.fn(async () => {
        throw new Error('gemini down')
      }),
    })
    expect((await runAsk(deps, input)).outcome).toBe('error')
    expect(logged).toHaveLength(1)
  })

  it.each([402, 429, 503, undefined])(
    'reports ai_unavailable when the provider fails with %s',
    async (status) => {
      const { deps, logged } = makeDeps({
        embed: vi.fn(async () => {
          throw new GeminiError('embed failed', status)
        }),
      })
      expect(await runAsk(deps, input)).toEqual({
        outcome: 'error',
        message: AI_UNAVAILABLE_MESSAGE,
        reason: 'ai_unavailable',
      })
      expect(logged[0]?.outcome).toBe('error')
    },
  )

  it('reports ai_unavailable when answer generation is out of credit', async () => {
    const { deps } = makeDeps({
      generate: vi.fn(async () => {
        throw new ClaudeError('generate returned 400: credit balance is too low', true, 400)
      }),
    })
    expect(await runAsk(deps, input)).toMatchObject({ reason: 'ai_unavailable' })
  })

  it.each([
    ['a refusal', new ClaudeRefusalError('cyber')],
    ['a bad request', new GeminiError('embed returned 400', 400)],
    ['a plain bug', new Error('bug')],
  ])('keeps the generic error for %s', async (_label, failure) => {
    const { deps } = makeDeps({
      generate: vi.fn(async () => {
        throw failure
      }),
    })
    const result = await runAsk(deps, input)
    expect(result).toMatchObject({ outcome: 'error' })
    expect(result).not.toHaveProperty('reason')
  })

  it('survives a failing ask_query insert', async () => {
    const { deps } = makeDeps({
      logQuery: async () => {
        throw new Error('db down')
      },
    })
    expect((await runAsk(deps, input)).outcome).toBe('answered')
  })
})
