import { createDb, createLogger, renderKey } from '@reelset/core'
import { sql } from 'kysely'
import { DEFAULT_VOICE, TEMPLATE_VERSION } from '../../workers/render/src/constants'

// Sets render.template_version for rows where it is NULL by matching each render_key against the
// key of every template version (1..current) for its item. Safe to re-run; --apply to write.
// Re-run after the render worker deploy to cover rows finished by the previous worker.
const apply = process.argv.includes('--apply')
const extraVoices = process.argv.filter((a) => a.startsWith('--voice=')).map((a) => a.slice(8))
const voices = [DEFAULT_VOICE, ...extraVoices]
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  const rows = await sql<{
    id: string
    render_key: string
    item_id: string
    content_hash: string | null
    prompt_version: string | null
  }>`select r.id, r.render_key, r.item_id, i.content_hash, i.prompt_version
     from render r join item i on i.id = r.item_id
     where r.template_version is null`.execute(db)
  const tally: Record<string, number> = {}
  let unmatched = 0
  for (const row of rows.rows) {
    let found: number | null = null
    if (row.content_hash && row.prompt_version) {
      outer: for (let v = Number(TEMPLATE_VERSION); v >= 1; v--) {
        for (const voice of voices) {
          const key = await renderKey({
            itemId: row.item_id,
            contentHash: row.content_hash,
            promptVersion: row.prompt_version,
            templateVersion: String(v),
            voice,
          })
          if (key === row.render_key) {
            found = v
            break outer
          }
        }
      }
    }
    if (found === null) {
      unmatched++
      continue
    }
    tally[found] = (tally[found] ?? 0) + 1
    if (apply) {
      await sql`update render set template_version = ${found} where id = ${row.id}`.execute(db)
    }
  }
  log.info({ apply, nullRows: rows.rows.length, unmatched, tally }, 'render template backfill')
} finally {
  await close()
}
