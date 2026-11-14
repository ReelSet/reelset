import { describe, expect, it } from 'vitest'
import type { Database } from '@reelset/core'
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type QueryResult,
} from 'kysely'
import { servedReelsQuery } from './related-reels'
import {
  countRenderedReels,
  listReelSummaries,
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
