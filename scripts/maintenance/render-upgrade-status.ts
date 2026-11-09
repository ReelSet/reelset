import { createDb, createLogger, renderKey } from '@reelset/core'
import { sql } from 'kysely'
import { DEFAULT_VOICE, TEMPLATE_VERSION } from '../../workers/render/src/constants'

// Read-only: which rendered items already have a render for the current template version.
// The render worker's cron queues the missing ones (docs/contracts.md, "Render engine").
const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
try {
  const items = await sql<{
    id: string
    title: string
    content_hash: string
    prompt_version: string
  }>`select id, title, content_hash, prompt_version from item
     where status = 'rendered' and content_hash is not null order by published_at desc`.execute(db)
  const rows = []
  for (const item of items.rows) {
    const key = await renderKey({
      itemId: item.id,
      contentHash: item.content_hash,
      promptVersion: item.prompt_version,
      templateVersion: TEMPLATE_VERSION,
      voice: DEFAULT_VOICE,
    })
    const render = await sql<{
      status: string
      bytes: number | null
      render_ms: number | null
      video_duration_ms: number | null
      attempts: number
      error: string | null
    }>`select status, bytes, render_ms, video_duration_ms, attempts, error from render where render_key = ${key}`.execute(
      db,
    )
    const r = render.rows[0]
    rows.push({
      item: item.id.slice(0, 8),
      title: item.title.slice(0, 36),
      current: r?.status ?? 'missing',
      mb: r?.bytes ? Number((r.bytes / 1e6).toFixed(1)) : null,
      renderS: r?.render_ms ? Math.round(r.render_ms / 1000) : null,
      durS: r?.video_duration_ms ? Math.round(r.video_duration_ms / 1000) : null,
      attempts: r?.attempts ?? null,
      error: r?.error ?? null,
    })
  }
  console.table(rows)
  const done = rows.filter((r) => r.current === 'done')
  console.log(
    `template ${TEMPLATE_VERSION}: ${done.length}/${rows.length} done`,
    done.length
      ? `avg render ${Math.round(done.reduce((n, r) => n + (r.renderS ?? 0), 0) / done.length)}s avg ${(done.reduce((n, r) => n + (r.mb ?? 0), 0) / done.length).toFixed(1)}MB`
      : '',
  )
} finally {
  await close()
}
