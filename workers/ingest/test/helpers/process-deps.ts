import { vi } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '@reelset/core'
import type { ProcessDeps } from '../../src/pipeline/process'
import { createFakeDb, type RecordedQuery } from './fake-db'
import { testLog } from './mock-fetch'

export const ITEM_ID = '9e1c2b0a-0000-4000-8000-000000000001'
export const CHUNK_1 = '11111111-1111-4111-8111-111111111111'
export const CHUNK_2 = '22222222-2222-4222-8222-222222222222'

export type World = {
  status: string
  canonicalKey: string
  queuedAt: Date | null
  transitionLost: boolean
  mentions: Record<string, unknown>[]
  chunks: { id: string; text: string }[]
}

export function makeWorld(overrides: Partial<World> = {}): World {
  return {
    status: 'found',
    canonicalKey: 'github:acme/repo',
    queuedAt: new Date('2026-11-09T10:00:00Z'),
    transitionLost: false,
    mentions: [
      {
        id: 'm1',
        source: 'github',
        external_id: '1',
        url: 'https://github.com/acme/repo',
        title: 'acme/repo',
        body: `A fast queue library for Cloudflare Workers. ${'It batches and retries messages reliably. '.repeat(5)}`,
        raw: { extraTexts: [] },
      },
    ],
    chunks: [
      { id: CHUNK_1, text: 'A fast queue library for Cloudflare Workers. It batches messages.' },
      { id: CHUNK_2, text: 'Retries are built in.' },
    ],
    ...overrides,
  }
}

export const validOutput = (chunkId = CHUNK_1, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    tldr: 'A fast queue library for Workers.',
    topics: ['Queues'],
    script: {
      version: 1,
      hook: 'A queue library for Workers',
      beats: [
        { text: 'It batches messages', visual: { type: 'title', title: 'acme/repo' } },
        { text: 'Retries are built in', visual: { type: 'stat', label: 'Retries', value: '3' } },
      ],
      outro: 'Check it out',
      claims: [{ text: 'It batches messages', chunkIds: [chunkId] }],
      ...extra,
    },
  })

export function makeDeps(
  world: World,
  llmOutputs: (string | Error)[],
  extra: (q: RecordedQuery) => unknown[] | undefined = () => undefined,
) {
  const handler = (q: RecordedQuery) => {
    const sql = q.sql
    const custom = extra(q)
    if (custom) return custom
    if (sql.includes('from "item" where "id"')) {
      return [
        {
          id: ITEM_ID,
          canonical_key: world.canonicalKey,
          canonical_url: 'https://github.com/acme/repo',
          kind: 'repo',
          title: 'acme/repo',
          status: world.status,
          tldr: world.status === 'found' ? null : 'A fast queue library for Workers.',
          topics: ['queues'],
          queued_at: world.queuedAt,
        },
      ]
    }
    if (sql.includes('from "mention"')) return world.mentions
    if (sql.includes('from "evidence_chunk"')) return world.chunks
    if (sql.includes('embedding is null')) return world.chunks
    if (sql.startsWith('update "item" set "status"')) {
      if (world.transitionLost) return { rows: [], affected: 0 }
      world.status = String(q.params[0])
      return { rows: [], affected: 1 }
    }
    if (sql.startsWith('update "item" set "queued_at" = now()')) {
      world.queuedAt = new Date()
      return { rows: [], affected: 1 }
    }
    if (sql.startsWith('update "item" set "queued_at" = $1')) {
      world.queuedAt = null
      return { rows: [], affected: 1 }
    }
    return undefined
  }
  const fake = createFakeDb(handler)
  const generate = vi.fn(async (_req: { system: string; user: string }) => {
    const next = llmOutputs.shift()
    if (next === undefined) throw new Error('llm called more often than scripted')
    if (next instanceof Error) throw next
    return { text: next, usage: { inputTokens: 1000, outputTokens: 500 } }
  })
  const embed = vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0))),
  )
  const transcriptFetch = vi.fn()
  const send = vi.fn(async (_message: { itemId: string; attempt: number }) => {})
  const deps: ProcessDeps = {
    db: fake.db,
    log: testLog,
    llm: { generate },
    embedder: { embed },
    transcripts: { fetch: transcriptFetch },
    renderQueue: { send },
    geminiModel: 'gemini-test',
    embeddingModel: 'embed-test',
  }
  return { deps, fake, generate, embed, transcriptFetch, send, world }
}

export function transitionTargets(queries: RecordedQuery[]): string[] {
  return queries
    .filter((q) => q.sql.startsWith('update "item" set "status"'))
    .map((q) => String(q.params[0]))
}
