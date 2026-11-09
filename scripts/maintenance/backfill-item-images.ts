import { createDb, createLogger } from '@reelset/core'
import { captureItemImages } from '../../workers/ingest/src/images'

// Usage: backfill-item-images.ts [--apply] [--force] [--limit N]
// Captures real source images for rendered/pending items. Dry run unless --apply.
const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 500
const log = createLogger({ app: 'backfill-images', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 2 })

try {
  let q = db
    .selectFrom('item')
    .select(['id', 'canonical_key', 'canonical_url', 'title'])
    .where('status', 'in', ['rendered', 'embedded', 'voiced'])
    .orderBy('published_at', 'desc')
    .limit(limit)
  if (!force) q = q.where('images', 'is', null)
  const items = await q.execute()
  console.log(`items to process: ${items.length} (apply=${apply})`)

  const stats: Record<string, { items: number; withImages: number }> = {}
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!
      const images = await captureItemImages(
        { canonicalKey: item.canonical_key, canonicalUrl: item.canonical_url, mentionUrls: [] },
        { log, githubToken: process.env.GITHUB_TOKEN },
      )
      const kind = item.canonical_key.split(':')[0]!.startsWith('http')
        ? 'article'
        : item.canonical_key.split(':')[0]!
      const s = (stats[kind] ??= { items: 0, withImages: 0 })
      s.items++
      if (images.length > 0) s.withImages++
      if (apply) {
        await db
          .updateTable('item')
          .set({ images: JSON.stringify(images) })
          .where('id', '=', item.id)
          .execute()
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  console.table(stats)
} finally {
  await close()
}
