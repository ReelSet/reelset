import { createLogger } from '@reelset/core'
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ storedAskModel: undefined as unknown }))

function settingRows(query: CompiledQuery): QueryResult<unknown> {
  const isAskModel = query.sql.includes('app_setting') && query.parameters.includes('ask_model')
  const rows =
    isAskModel && state.storedAskModel !== undefined ? [{ value: state.storedAskModel }] : []
  return { rows }
}

const connection: DatabaseConnection = {
  executeQuery: async <R>(query: CompiledQuery) => settingRows(query) as QueryResult<R>,
  streamQuery: () => {
    throw new Error('not supported')
  },
}

const driver: Driver = {
  init: async () => undefined,
  acquireConnection: async () => connection,
  beginTransaction: async () => undefined,
  commitTransaction: async () => undefined,
  rollbackTransaction: async () => undefined,
  releaseConnection: async () => undefined,
  destroy: async () => undefined,
}

const stubDb = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => driver,
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})

vi.mock('./db', () => ({ getDb: () => stubDb }))
vi.mock('@/lib/ask/claude', () => ({
  generateAnswer: vi.fn(async (config: { model: string }) => ({
    text: '',
    model: config.model,
    inputTokens: 0,
    outputTokens: 0,
    parsed: null,
  })),
}))

const { generateAnswer } = await import('@/lib/ask/claude')
const { createAskDeps } = await import('./ask-deps')
const log = createLogger({ app: 'test', level: 'silent' })

describe('createAskDeps generate', () => {
  beforeEach(() => {
    vi.stubEnv('CLAUDE_API_KEY', 'sk-test')
    vi.mocked(generateAnswer).mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    state.storedAskModel = undefined
  })

  it('answers with the model stored in app_setting ask_model', async () => {
    state.storedAskModel = 'claude-sonnet-5-5'
    const answer = await createAskDeps(log).generate('q', [], () => undefined)
    expect(answer.model).toBe('claude-sonnet-5-5')
    expect(vi.mocked(generateAnswer).mock.calls[0]?.[0]).toEqual({
      apiKey: 'sk-test',
      model: 'claude-sonnet-5-5',
    })
  })

  it('falls back to Haiku when the setting is missing or invalid', async () => {
    const deps = createAskDeps(log)
    expect((await deps.generate('q', [], () => undefined)).model).toBe('claude-haiku-5-5')
    state.storedAskModel = 'gpt-5'
    expect((await deps.generate('q', [], () => undefined)).model).toBe('claude-haiku-5-5')
  })
})
