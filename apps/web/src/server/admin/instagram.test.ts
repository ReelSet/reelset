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
import { dummyDb } from '@/test/dummy-db'
import { composerReel, postQueue, queueInstagramPost, servedRenderQuery } from './instagram'

const log = createLogger({ app: 'test', level: 'silent' })
const ITEM_ID = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'
const SERVED_KEY = `reels/${ITEM_ID}/new.mp4`
const FEED_ORDER =
  /order by coalesce\(r\.template_version, 0\) desc, r\.finished_at desc nulls last, r\.created_at desc/

type Rows = (query: CompiledQuery) => Record<string, unknown>[]

function scriptedDb(rows: Rows) {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(query)
      return { rows: rows(query) as R[] }
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

describe('instagram render selection', () => {
  it('picks the render the feed serves: newest template first, then newest finished', () => {
    expect(servedRenderQuery(dummyDb, ITEM_ID).compile().sql).toMatch(FEED_ORDER)
  })

  it('previews video and poster from that same served render', async () => {
    const t = scriptedDb(() => [{ id: ITEM_ID, title: 'T', video_key: SERVED_KEY, topics: [] }])
    await composerReel(t.db, ITEM_ID)
    const sql = t.queries[0]?.sql ?? ''
    expect(sql.match(new RegExp(FEED_ORDER.source, 'g'))?.length).toBe(3)
  })

  it('shows each queued post with the poster of the render it posts', async () => {
    const t = scriptedDb(() => [])
    await postQueue(t.db)
    expect(t.queries[0]?.sql).toMatch(/r\.video_key = instagram_post\.video_key/)
  })
})

function servedDb(videoKey: string | null) {
  return scriptedDb((q) =>
    q.sql.startsWith('insert') ? [{ id: 'p1' }] : videoKey ? [{ video_key: videoKey }] : [],
  )
}

describe('queueInstagramPost', () => {
  const input = { itemId: ITEM_ID, videoKey: SERVED_KEY, caption: 'hi', adminId: 'a1' }

  it('queues the previewed render when it is still the served one', async () => {
    const t = servedDb(SERVED_KEY)
    expect(await queueInstagramPost(t.db, input, log)).toMatchObject({ ok: true })
    const insert = t.queries.find((q) => q.sql.startsWith('insert'))
    expect(insert?.parameters).toEqual(expect.arrayContaining([ITEM_ID, SERVED_KEY, 'hi']))
  })

  it('refuses a stale preview instead of posting a different render', async () => {
    const t = servedDb(SERVED_KEY)
    const old = { ...input, videoKey: `reels/${ITEM_ID}/old.mp4` }
    const result = await queueInstagramPost(t.db, old, log)
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/re-rendered/) })
    expect(t.queries.some((q) => q.sql.startsWith('insert'))).toBe(false)
  })

  it('refuses when the item has no finished render', async () => {
    const t = servedDb(null)
    expect(await queueInstagramPost(t.db, input, log)).toMatchObject({ ok: false })
  })
})
