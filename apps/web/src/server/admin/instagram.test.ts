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
import {
  FAILED_LIMIT,
  QUEUE_LIMIT,
  composerReel,
  failedPosts,
  postQueue,
  queueInstagramPost,
  retryFailedPost,
  servedRenderQuery,
} from './instagram'

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
      const out = rows(query)
      return { rows: out as R[], numAffectedRows: BigInt(out.length) }
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

  it('lists queued posts first in the order the worker will claim them', async () => {
    const t = scriptedDb(() => [])
    await postQueue(t.db)
    const sql = t.queries[0]?.sql ?? ''
    const order = sql.slice(sql.indexOf('order by'))
    expect(order).toMatch(/^order by \(instagram_post\.status = \$\d+\) desc,/)
    expect(order).toMatch(/instagram_post\.requested_by = \$\d+/)
    expect(order).toMatch(/from gate_decision d/)
    expect(order).toMatch(/select i\.score \* 100 from item i/)
    expect(order).toMatch(/desc nulls last/)
    expect(order).toMatch(/"instagram_post"\."created_at" desc/)
    expect(sql).toMatch(/"instagram_post"\."requested_by"/)
  })

  it('keeps failed posts in their own list so they cannot push live posts off the page', async () => {
    const t = scriptedDb(() => [])
    await postQueue(t.db)
    await failedPosts(t.db)
    const [live, failed] = t.queries
    expect(live?.sql).toMatch(/"instagram_post"\."status" != \$\d/)
    expect(live?.parameters).toEqual(expect.arrayContaining(['deleted', 'failed', QUEUE_LIMIT]))
    expect(failed?.sql).toMatch(/"instagram_post"\."status" = \$\d/)
    expect(failed?.parameters).toEqual(expect.arrayContaining(['failed', FAILED_LIMIT]))
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

describe('retryFailedPost', () => {
  const POST_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'

  it('queues a failed post again and says so', async () => {
    const t = scriptedDb((q) => (q.sql.startsWith('update') ? [{ id: POST_ID }] : []))
    expect(await retryFailedPost(t.db, { postId: POST_ID }, log)).toMatchObject({ ok: true })
  })

  it('explains a refusal instead of failing', async () => {
    const t = scriptedDb((q) =>
      q.sql.startsWith('update')
        ? []
        : [{ item_id: ITEM_ID, status: 'queued', error: null, started_at: null }],
    )
    expect(await retryFailedPost(t.db, { postId: POST_ID }, log)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Only a post that did not go out/),
    })
  })

  it('reports a missing post', async () => {
    const t = scriptedDb(() => [])
    expect(await retryFailedPost(t.db, { postId: POST_ID }, log)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/no longer exists/),
    })
  })
})
