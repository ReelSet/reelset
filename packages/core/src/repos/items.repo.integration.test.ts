import { config } from 'dotenv'
import { sql } from 'kysely'
import pino from 'pino'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/client'
import { EMBEDDING_DIMENSIONS } from '../domain/embedding'
import { InvalidTransitionError } from '../domain/item-status'
import { StaleTransitionError, setItemEmbedding, transitionItem } from './items.repo'

config({ path: new URL('../../../../.env.local', import.meta.url).pathname, quiet: true })

const enabled = process.env['RUN_DB_TESTS'] === '1' && Boolean(process.env['DATABASE_URL'])
const log = pino({ level: 'silent' })

class Rollback extends Error {}

describe.skipIf(!enabled)('items repo against Supabase (rolled back)', () => {
  const handle = enabled
    ? createDb({ connectionString: process.env['DATABASE_URL']!, log, max: 2 })
    : null

  afterAll(async () => {
    await handle?.close()
  })

  async function inRollback(fn: (db: NonNullable<typeof handle>['db']) => Promise<void>) {
    await expect(
      handle!.db.transaction().execute(async (trx) => {
        await fn(trx)
        throw new Rollback()
      }),
    ).rejects.toBeInstanceOf(Rollback)
  }

  async function insertItem(db: NonNullable<typeof handle>['db']) {
    const row = await db
      .insertInto('item')
      .values({
        canonical_key: `test:${crypto.randomUUID()}`,
        canonical_url: 'https://example.com/test',
        kind: 'repo',
        title: 'integration test item',
        published_at: new Date(),
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow()
    return row
  }

  it('advances status and writes an item_event in the same transaction', async () => {
    await inRollback(async (db) => {
      const item = await insertItem(db)
      expect(item.status).toBe('found')

      await transitionItem(db, { itemId: item.id, from: 'found', to: 'summarized' }, log)

      const after = await db
        .selectFrom('item')
        .select(['status'])
        .where('id', '=', item.id)
        .executeTakeFirstOrThrow()
      expect(after.status).toBe('summarized')

      const events = await db
        .selectFrom('item_event')
        .select(['stage', 'outcome'])
        .where('item_id', '=', item.id)
        .execute()
      expect(events).toEqual([{ stage: 'summarized', outcome: 'ok' }])
    })
  })

  it('loses cleanly when the status already moved (duplicate delivery)', async () => {
    await inRollback(async (db) => {
      const item = await insertItem(db)
      await expect(
        transitionItem(db, { itemId: item.id, from: 'summarized', to: 'embedded' }, log),
      ).rejects.toBeInstanceOf(StaleTransitionError)
    })
  })

  it('refuses illegal transitions before touching the database', async () => {
    await inRollback(async (db) => {
      const item = await insertItem(db)
      await expect(
        transitionItem(db, { itemId: item.id, from: 'found', to: 'rendered' }, log),
      ).rejects.toBeInstanceOf(InvalidTransitionError)
    })
  })

  it('stores a 768-dim embedding through pgvector', async () => {
    await inRollback(async (db) => {
      const item = await insertItem(db)
      const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01)
      await setItemEmbedding(db, item.id, vector, log)
      const result = await sql<{
        dims: number
      }>`select vector_dims(embedding) as dims from item where id = ${item.id}`.execute(db)
      expect(result.rows[0]?.dims).toBe(EMBEDDING_DIMENSIONS)
    })
  })
})
