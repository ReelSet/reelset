import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'

// Writes the 360 px WebP thumbnail for every finished render that has a poster but no thumb_key:
// poster from the media host -> ffmpeg (same arguments as build_thumb_cmd in the render container)
// -> R2 next to the poster -> render.thumb_key. Rerunning skips rows that already have one.
// Usage: node --env-file=.env.local --import tsx scripts/backfill-thumbs.mts [--dry-run] [--limit N]
// --dry-run still downloads and converts (so sizes show) but uploads nothing and writes nothing.

const run = promisify(execFile)
const dryRun = process.argv.includes('--dry-run')
const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const limit = Number(arg('--limit') ?? 0) || null
const CONCURRENCY = 4

const BUCKET = 'reelset-media'
const CACHE_CONTROL = 'public, max-age=604800'
const FFMPEG = process.env.FFMPEG_BIN ?? '/opt/homebrew/bin/ffmpeg'
const WRANGLER_DIR = new URL('../workers/render/', import.meta.url).pathname

const mediaBase = process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/+$/, '')
if (!mediaBase) throw new Error('MEDIA_PUBLIC_BASE_URL must be set')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'backfill-thumbs', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })

type Row = { id: string; render_key: string; poster_key: string }

// Errors from fetch or wrangler can carry URLs; never let one reach the log.
const clean = (err: unknown) =>
  (err instanceof Error ? err.message : String(err))
    .replace(/https?:\/\/\S+/g, '<url>')
    .slice(0, 200)

const thumbKeyOf = (posterKey: string) =>
  /^reels\/[^/]+\/[^/]+\.jpg$/.test(posterKey) ? posterKey.replace(/\.jpg$/, '.thumb.webp') : null

async function hasLibwebp(): Promise<boolean> {
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-encoders'])
    return stdout.includes('libwebp')
  } catch {
    return false
  }
}

async function convert(useFfmpeg: boolean, poster: string, out: string) {
  if (useFfmpeg) {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', poster]
    await run(FFMPEG, [...args, '-vf', 'scale=360:-2', '-c:v', 'libwebp', '-quality', '75', out])
  } else {
    // Homebrew's ffmpeg is often built without libwebp; cwebp gives the same 360x640 at quality 75.
    await run('cwebp', ['-quiet', '-q', '75', '-resize', '360', '640', poster, '-o', out])
  }
}

async function upload(key: string, file: string) {
  const env = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' }
  delete env.CLOUDFLARE_API_TOKEN
  const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file]
  const options = ['--content-type', 'image/webp', '--cache-control', CACHE_CONTROL, '--remote']
  await run('npx', [...args, ...options], { env, cwd: WRANGLER_DIR })
}

async function main() {
  const { rows: cols } = await sql<{ n: number }>`select count(*)::int as n
    from information_schema.columns where table_name = 'render' and column_name = 'thumb_key'`.execute(
    db,
  )
  const hasColumn = (cols[0]?.n ?? 0) > 0
  if (!hasColumn && !dryRun) throw new Error('render.thumb_key does not exist; run db:deploy first')

  const useFfmpeg = await hasLibwebp()
  const rows = (
    hasColumn
      ? await sql<Row>`select id, render_key, poster_key from render
          where poster_key is not null and thumb_key is null and status = 'done'
          order by finished_at desc nulls last`.execute(db)
      : await sql<Row>`select id, render_key, poster_key from render
          where poster_key is not null and status = 'done'
          order by finished_at desc nulls last`.execute(db)
  ).rows
  const todo = limit ? rows.slice(0, limit) : rows
  log.info(
    {
      dryRun,
      todo: todo.length,
      of: rows.length,
      encoder: useFfmpeg ? 'ffmpeg' : 'cwebp',
      hasColumn,
    },
    'thumb backfill start',
  )
  if (!hasColumn)
    log.warn({}, 'thumb_key column not deployed yet: listing every render with a poster')

  const work = mkdtempSync(join(tmpdir(), 'reelset-thumbs-'))
  let ok = 0
  let totalBytes = 0
  const failed: string[] = []
  let next = 0

  const one = async (row: Row) => {
    const thumbKey = thumbKeyOf(row.poster_key)
    if (!thumbKey) throw new Error('poster key is not a reel poster')
    const poster = join(work, `${row.id}.jpg`)
    const out = join(work, `${row.id}.webp`)
    try {
      const res = await fetch(`${mediaBase}/${row.poster_key}`)
      if (!res.ok) throw new Error(`poster download ${res.status}`)
      writeFileSync(poster, Buffer.from(await res.arrayBuffer()))
      await convert(useFfmpeg, poster, out)
      const bytes = readFileSync(out).byteLength
      if (!dryRun) {
        await upload(thumbKey, out)
        await sql`update render set thumb_key = ${thumbKey} where id = ${row.id}::uuid and thumb_key is null`.execute(
          db,
        )
      }
      ok++
      totalBytes += bytes
      log.info(
        { renderKey: row.render_key, bytes, dryRun },
        dryRun ? 'would upload thumb' : 'thumb saved',
      )
    } finally {
      rmSync(poster, { force: true })
      rmSync(out, { force: true })
    }
  }

  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++]!
      try {
        await one(row)
      } catch (err) {
        failed.push(row.render_key)
        log.warn({ renderKey: row.render_key, err: clean(err) }, 'thumb failed')
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  rmSync(work, { recursive: true, force: true })
  log.info(
    { dryRun, ok, failed: failed.length, avgBytes: ok ? Math.round(totalBytes / ok) : 0 },
    'thumb backfill done',
  )
  if (failed.length) process.exitCode = 1
}

try {
  await main()
} finally {
  await close()
}
