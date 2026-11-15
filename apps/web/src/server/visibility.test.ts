import { describe, expect, it } from 'vitest'
import { createLogger, type Database } from '@reelset/core'
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type QueryResult,
} from 'kysely'
import { hydrateQuery } from '@/lib/ranking/sql'
import { parseReelParam } from '@/lib/reel-url'
import { libraryQuery } from './profile'
import { servedReelsQuery } from './related-reels'
import {
  countRenderedReels,
  listReelSummaries,
  loadReelPage,
  listReelTranscripts,
  listSourceCounts,
  listTopicLabels,
} from './seo-queries'

function recordingDb() {
  const statements: string[] = []
  const connection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      statements.push(q.sql)
      return { rows: [] }
    },
    async *streamQuery() {},
  }
  const db = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => {},
        acquireConnection: async () => connection,
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
        destroy: async () => {},
      }),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  }) as unknown as Database
  return { db, statements }
}

describe('private reels stay out of public listings', () => {
  it('filters every SEO query on visibility', async () => {
    const { db, statements } = recordingDb()
    await listReelSummaries(db, 'https://m.test', { limit: 5 })
    await countRenderedReels(db)
    await listSourceCounts(db)
    await listTopicLabels(db)
    await listReelTranscripts(db, 'https://m.test', 5)
    expect(statements).toHaveLength(5)
    for (const sql of statements) expect(sql).toContain("i.visibility = 'public'")
  })

  it('filters related reels', () => {
    const { db } = recordingDb()
    expect(servedReelsQuery(db, ['a'], 0).compile().sql).toContain('"item"."visibility" = $')
  })
})

describe('hidden reels stay out of every other surface', () => {
  it('the reel page loader excludes hidden items in SQL', async () => {
    const { db, statements } = recordingDb()
    const param = parseReelParam('0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b')!
    const log = createLogger({ app: 'test', level: 'silent' })
    expect(await loadReelPage(db, param, 'https://m.test', log)).toBeNull()
    expect(statements[0]).toContain("i.visibility <> 'hidden'")
  })

  it('feed hydration excludes hidden items', () => {
    const { db } = recordingDb()
    const sql = hydrateQuery(db, { profileId: null, itemIds: ['a'], minTemplate: 0 }).compile().sql
    expect(sql).toContain('"item"."visibility" <> $')
  })

  it.each(['like', 'save'] as const)('the %s library excludes hidden items', (table) => {
    const { db } = recordingDb()
    expect(libraryQuery(db, table, 'p').compile().sql).toContain('"item"."visibility" <> $')
  })
})
