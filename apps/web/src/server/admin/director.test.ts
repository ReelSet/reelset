import { createLogger, type Database } from '@reelset/core'
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
import { describe, expect, it } from 'vitest'
import {
  createDirectorSkill,
  recentDirectorRuns,
  resetDirectorSetting,
  saveDirectorSetting,
  saveDirectorSkill,
} from './director'

const log = createLogger({ app: 'test', level: 'silent' })
const ID = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'

function scriptedDb(respond: (q: CompiledQuery) => Record<string, unknown>[] | Error) {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(query)
      const out = respond(query)
      if (out instanceof Error) throw out
      return {
        rows: out as R[],
        numAffectedRows: BigInt(out.length),
        numChangedRows: BigInt(out.length),
      }
    },
    streamQuery: () => {
      throw new Error('not used')
    },
  }
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  }
  const db = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  }) as unknown as Database
  return { db, queries }
}

describe('director settings commands', () => {
  it('writes a valid value and never touches the db for an invalid one', async () => {
    const t = scriptedDb(() => [])
    expect(await saveDirectorSetting(t.db, { name: 'directorEffort', raw: 'max' }, log)).toEqual({
      ok: true,
      message: 'director_effort saved',
    })
    expect(t.queries[0]?.sql).toMatch(/insert into "app_setting"/)
    expect(t.queries[0]?.parameters).toContain('"max"')

    const bad = scriptedDb(() => [])
    const res = await saveDirectorSetting(bad.db, { name: 'directorMaxTokens', raw: '5' }, log)
    expect(res.ok).toBe(false)
    expect(bad.queries).toEqual([])
  })

  it('resets a setting to its default value', async () => {
    const t = scriptedDb(() => [])
    const res = await resetDirectorSetting(t.db, { name: 'directorMaxTokens' }, log)
    expect(res.ok).toBe(true)
    expect(t.queries[0]?.parameters).toContain('128000')
    expect((await resetDirectorSetting(t.db, { name: 'dailyReelCap' }, log)).ok).toBe(false)
  })
})

describe('director skill commands', () => {
  it('validates before writing', async () => {
    const t = scriptedDb(() => [])
    expect(
      (await createDirectorSkill(t.db, { name: '', kind: 'skill', content: 'x' }, log)).ok,
    ).toBe(false)
    expect(t.queries).toEqual([])
  })

  it('reports a taken name on rename instead of throwing', async () => {
    const t = scriptedDb(() => Object.assign(new Error('dup'), { code: '23505' }))
    const res = await saveDirectorSkill(
      t.db,
      { id: ID, name: 'a', kind: 'skill', content: 'x' },
      log,
    )
    expect(res).toEqual({ ok: false, message: 'Another skill is already named a' })
  })

  it('rethrows unexpected database errors', async () => {
    const t = scriptedDb(() => Object.assign(new Error('boom'), { code: '57P01' }))
    await expect(
      saveDirectorSkill(t.db, { id: ID, name: 'a', kind: 'skill', content: 'x' }, log),
    ).rejects.toThrow('boom')
  })
})

describe('recentDirectorRuns', () => {
  it('queries renders with a director report newest first and skips unreadable rows', async () => {
    const meta = {
      used: true,
      model: 'claude-haiku-5-5',
      scenes: 4,
      sceneErrors: 0,
      fallbackReason: null,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ms: 900,
    }
    const t = scriptedDb(() => [
      {
        id: 'r1',
        item_id: 'i1',
        title: 'T',
        finished_at: new Date(0),
        created_at: new Date(0),
        render_ms: 60_000,
        director: meta,
      },
      {
        id: 'r2',
        item_id: 'i2',
        title: 'U',
        finished_at: null,
        created_at: new Date(0),
        render_ms: null,
        director: 'junk',
      },
    ])
    const runs = await recentDirectorRuns(t.db, 30)
    expect(runs.map((r) => r.renderId)).toEqual(['r1'])
    expect(runs[0]).toMatchObject({ title: 'T', renderMs: 60_000, director: { scenes: 4 } })
    const sql = t.queries[0]?.sql ?? ''
    expect(sql).toMatch(/"render"."director" is not null/)
    expect(sql).toMatch(/order by render.finished_at desc nulls last/)
    expect(t.queries[0]?.parameters).toContain(30)
  })
})
