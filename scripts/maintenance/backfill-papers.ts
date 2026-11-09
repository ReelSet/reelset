import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PAPER_PARSER_VERSION,
  createDb,
  createLogger,
  parseItemImages,
  parsedPaperSchema,
  type ItemImage,
  type ParsedPaper,
} from '@reelset/core'
import { mergeImages, paperFigureImages } from '../../workers/ingest/src/images'

// Usage: backfill-papers.ts [--apply] [--all] [--limit N] [--id 2611.08264]
// Parses arXiv items with the container parser run locally (python), uploads figures and the parsed
// JSON to R2 (papers/<id>/...), and rewrites item.images with the original-resolution figures.
// Default scope: papers in the feed (status rendered). Dry run unless --apply.
const apply = process.argv.includes('--apply')
const all = process.argv.includes('--all')
const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const limit = Number(arg('--limit') ?? 50)
const onlyId = arg('--id')
const PUBLIC_BASE = (process.env.MEDIA_PUBLIC_BASE_URL ?? 'https://media.reelset.app').replace(
  /\/$/,
  '',
)
const BUCKET = 'reelset-media'
const CONTAINER = new URL('../../workers/render/container/', import.meta.url).pathname
const WRANGLER_DIR = new URL('../../workers/render/', import.meta.url).pathname
const PYTHON = process.env.PAPER_PYTHON ?? join(CONTAINER, '.venv/bin/python')
const WORK = join(process.env.TMPDIR ?? '/tmp', 'reelset-paper-backfill')

const log = createLogger({ app: 'backfill-papers', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 2 })

function put(key: string, file: string, contentType: string, cache?: string) {
  const args = [
    'wrangler',
    'r2',
    'object',
    'put',
    `${BUCKET}/${key}`,
    '--file',
    file,
    '--ct',
    contentType,
    '--remote',
  ]
  if (cache) args.push('--cc', cache)
  const env = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' }
  delete env.CLOUDFLARE_API_TOKEN
  execFileSync('npx', args, { stdio: 'pipe', env, cwd: WRANGLER_DIR })
}

type Row = {
  key: string
  source: string
  sections: number
  tables: number
  figures: number
  hires: number
  latexml: number
  ms: number
  images: string
}

try {
  let q = db
    .selectFrom('item')
    .select(['id', 'canonical_key', 'title', 'images', 'status'])
    .where('canonical_key', 'like', 'arxiv:%')
    .orderBy('published_at', 'desc')
    .limit(limit)
  if (!all) q = q.where('status', '=', 'rendered')
  if (onlyId) q = q.where('canonical_key', '=', `arxiv:${onlyId}`)
  const items = await q.execute()
  console.log(`paper items: ${items.length} (apply=${apply}, all=${all})`)

  const rows: Row[] = []
  for (const item of items) {
    const id = item.canonical_key.slice('arxiv:'.length)
    const dir = join(WORK, id.replace('/', '_'))
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    try {
      execFileSync(PYTHON, ['-W', 'ignore', '-m', 'reel.paper.cli', id, dir], {
        cwd: CONTAINER,
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 180_000,
      })
    } catch {
      console.log(`${id}: parser failed, item left as is`)
      continue
    }
    const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as {
      status: string
      paper: Record<string, unknown> & { figures: Record<string, unknown>[] }
      stats: { ms: number }
    }
    const keyId = id.replace('/', '_')
    const figures = result.paper.figures.map((f, i) => {
      const {
        file,
        ext: _ext,
        ...rest
      } = f as { file?: string; ext?: string } & Record<string, unknown>
      return {
        ...rest,
        url: file ? `${PUBLIC_BASE}/papers/${keyId}/${file}` : rest.url,
        _file: file,
      }
    })
    const paper: ParsedPaper = parsedPaperSchema.parse({
      ...result.paper,
      figures: figures.map(({ _file, ...f }) => f),
      version: PAPER_PARSER_VERSION,
    })
    writeFileSync(join(dir, 'paper.json'), JSON.stringify(paper))
    const current = parseItemImages(item.images)
    const figureImages: ItemImage[] = paperFigureImages(paper)
    const next = mergeImages([current.filter((i) => i.kind !== 'figure'), figureImages])

    if (apply) {
      for (const f of figures) {
        if (!f._file) continue
        const ext = f._file.endsWith('.png') ? 'png' : 'jpeg'
        put(
          `papers/${keyId}/${f._file}`,
          join(dir, f._file),
          `image/${ext}`,
          'public, max-age=31536000, immutable',
        )
      }
      put(`papers/${keyId}/paper.json`, join(dir, 'paper.json'), 'application/json')
      await db
        .updateTable('item')
        .set({ images: JSON.stringify(next) })
        .where('id', '=', item.id)
        .execute()
    }
    rows.push({
      key: id,
      source: paper.source,
      sections: paper.sections.length,
      tables: paper.tables.length,
      figures: paper.figures.length,
      hires: paper.figures.filter((f) => f.hires).length,
      latexml: paper.figures.filter((f) => f.origin === 'latexml').length,
      ms: result.stats.ms,
      images: `${current.length} -> ${next.length} (${next.filter((i) => i.url.includes('/papers/')).length} hi-res)`,
    })
    console.log(
      `${id}: ${rows[rows.length - 1]!.source}, ${paper.tables.length} tables, ${paper.figures.length} figures`,
    )
  }
  console.table(rows)
} finally {
  await close()
}
