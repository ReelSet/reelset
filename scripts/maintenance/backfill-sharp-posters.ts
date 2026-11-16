import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'

// Re-takes every finished reel's poster at its sharpest hook frame (reel/poster.py) and overwrites
// the same R2 key, so the feed, admin and Instagram links all keep working.
// Dry run by default (posters land in WORK/preview); --apply uploads. --limit N, --concurrency N.
// Progress is kept in WORK/done.json, so a rerun skips finished keys.

const run = promisify(execFile)
const apply = process.argv.includes('--apply')
const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const limit = Number(arg('--limit') ?? 0) || null
const concurrency = Math.max(1, Math.min(8, Number(arg('--concurrency') ?? 4)))

const BUCKET = 'reelset-media'
const CONTAINER = new URL('../../workers/render/container/', import.meta.url).pathname
const WRANGLER_DIR = new URL('../../workers/render/', import.meta.url).pathname
const PYTHON = process.env.POSTER_PYTHON ?? 'python3'
const WORK = join(process.env.TMPDIR ?? '/tmp', 'reelset-poster-backfill')
const DONE_FILE = join(WORK, 'done.json')
const PREVIEW = join(WORK, 'preview')

const mediaBase = process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, '')
if (!mediaBase) throw new Error('MEDIA_PUBLIC_BASE_URL must be set')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'backfill-sharp-posters', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })

type Row = { video_key: string; poster_key: string }

const loadDone = (): Set<string> =>
  new Set(existsSync(DONE_FILE) ? (JSON.parse(readFileSync(DONE_FILE, 'utf8')) as string[]) : [])

async function download(key: string, file: string) {
  const res = await fetch(`${mediaBase}/${key}`)
  if (!res.ok) throw new Error(`download ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

async function put(key: string, file: string) {
  const env = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' }
  delete env.CLOUDFLARE_API_TOKEN
  const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file]
  await run('npx', [...args, '--ct', 'image/jpeg', '--remote'], { env, cwd: WRANGLER_DIR })
}

async function fixOne(row: Row): Promise<{ second: number; fallback: boolean }> {
  const name = row.poster_key.replaceAll('/', '_')
  const video = join(WORK, `${name}.mp4`)
  const out = join(apply ? WORK : PREVIEW, name)
  try {
    await download(row.video_key, video)
    const { stdout } = await run(PYTHON, ['-m', 'reel.poster', video, out], { cwd: CONTAINER })
    const picked = JSON.parse(stdout.trim()) as { second: number; fallback: boolean }
    if (apply) await put(row.poster_key, out)
    return picked
  } finally {
    rmSync(video, { force: true })
    if (apply) rmSync(out, { force: true })
  }
}

async function main() {
  mkdirSync(PREVIEW, { recursive: true })
  const done = loadDone()
  const rows = (
    await sql<Row>`select r.video_key, r.poster_key from render r
      where r.status = 'done' and r.video_key is not null and r.poster_key is not null
      order by r.finished_at desc nulls last`.execute(db)
  ).rows.filter((r) => !done.has(r.poster_key))
  const todo = limit ? rows.slice(0, limit) : rows
  log.info({ apply, todo: todo.length, skipped: done.size, concurrency }, 'poster backfill start')

  let ok = 0
  let fallbacks = 0
  const failed: string[] = []
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++]!
      try {
        const picked = await fixOne(row)
        ok++
        if (picked.fallback) fallbacks++
        if (apply) {
          done.add(row.poster_key)
          writeFileSync(DONE_FILE, JSON.stringify([...done]))
        }
        if (ok % 25 === 0) log.info({ ok, of: todo.length, fallbacks }, 'poster backfill progress')
      } catch (err) {
        failed.push(row.poster_key)
        log.warn({ posterKey: row.poster_key, err: (err as Error).message }, 'poster failed')
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  log.info({ apply, ok, fallbacks, failed: failed.length, preview: apply ? null : PREVIEW }, 'done')
  if (failed.length) console.log(failed.join('\n'))
}

try {
  await main()
} finally {
  await close()
}
