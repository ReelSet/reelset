import { createDb, createLogger } from '@reelset/core'
import { rescoreItems } from '../../workers/ingest/src/ingest/persist'
import { chunked } from '../../workers/ingest/src/reconcile/policy'

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  const rows = await db.selectFrom('item').select('id').where('status', '=', 'found').execute()
  const now = new Date()
  for (const batch of chunked(rows, 200)) {
    await rescoreItems(
      db,
      batch.map((r) => r.id),
      now,
      log,
    )
  }
  console.log('rescored', rows.length, 'found items')
} finally {
  await close()
}
