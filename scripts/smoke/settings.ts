import { createDb, createLogger, SETTINGS, setSetting } from '@reelset/core'
import { sql } from 'kysely'
import fs from 'node:fs'
const cmd = process.argv[2]
const log = createLogger({ app: 'smoke', level: 'warn' })
const h = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const KEYS = ['daily_reel_cap', 'min_item_score']
const FILE = new URL('./.settings-backup.json', import.meta.url).pathname
try {
  if (cmd === 'prep') {
    const rows = await h.db.selectFrom('app_setting').select(['key', 'value']).where('key', 'in', KEYS).execute()
    const prev: Record<string, unknown> = {}
    for (const r of rows) prev[r.key] = r.value
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ prev, rows }))
    console.log('previous values', JSON.stringify(prev))
    await setSetting(h.db, SETTINGS.dailyReelCap, 5, log)
  } else if (cmd === 'restore') {
    const { rows } = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    for (const k of KEYS) {
      const r = rows.find((x: any) => x.key === k)
      if (r) await sql`insert into app_setting (key, value) values (${k}, ${JSON.stringify(r.value)}::jsonb) on conflict (key) do update set value = excluded.value`.execute(h.db)
      else await h.db.deleteFrom('app_setting').where('key', '=', k).execute()
    }
    const after = await h.db.selectFrom('app_setting').select(['key', 'value']).where('key', 'in', KEYS).execute()
    console.log('after restore', JSON.stringify(after))
  }
} finally { await h.close() }
