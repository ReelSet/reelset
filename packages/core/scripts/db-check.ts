import { config } from 'dotenv'
import { sql } from 'kysely'
import { createDb } from '../src/db/client'
import { createLogger, errorFields } from '../src/lib/logger'

config({ path: new URL('../../../.env.local', import.meta.url).pathname, quiet: true })

const log = createLogger({ app: 'db-check', level: 'info', pretty: true })
const url = process.env['DATABASE_URL']
if (!url) {
  log.error('DATABASE_URL is not set (expected in reelset/.env.local)')
  process.exit(1)
}

const { db, close } = createDb({ connectionString: url, log, max: 1 })
let failed = false

function check(name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  if (!ok) failed = true
  log[ok ? 'info' : 'error'](detail, `${ok ? 'PASS' : 'FAIL'} ${name}`)
}

try {
  const tables = await sql<{ name: string; rls: boolean }>`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`.execute(db)
  check('tables exist', tables.rows.length >= 15, { count: tables.rows.length })
  const exposed = tables.rows.filter((t) => !t.rls).map((t) => t.name)
  check('RLS enabled on every public table', exposed.length === 0, { exposed })

  const ext = await sql<{
    version: string
  }>`select extversion as version from pg_extension where extname = 'vector'`.execute(db)
  check('pgvector installed', ext.rows.length === 1, { version: ext.rows[0]?.version })

  const hnsw = await sql<{ name: string }>`
    select indexname as name from pg_indexes
    where schemaname = 'public' and indexname like '%_hnsw_idx' order by 1`.execute(db)
  check('HNSW indexes present', hnsw.rows.length === 2, { indexes: hnsw.rows.map((r) => r.name) })

  const migrations = await sql<{ name: string; finished: boolean }>`
    select migration_name as name, finished_at is not null as finished
    from _prisma_migrations order by started_at`.execute(db)
  check(
    'all migrations finished',
    migrations.rows.every((m) => m.finished),
    { migrations: migrations.rows.map((m) => m.name) },
  )
} catch (err) {
  failed = true
  log.error(errorFields(err), 'db check crashed')
} finally {
  await close()
}

process.exit(failed ? 1 : 0)
