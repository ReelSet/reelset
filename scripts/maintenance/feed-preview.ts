import { createDb, createLogger } from '@reelset/core'
import { loadCandidates } from '../../apps/web/src/lib/ranking/sql'
import { rankCandidates } from '../../apps/web/src/lib/ranking/scoring'

// Read-only: the anonymous cold-start feed order for a given feed_min_template (default 0).
const min = Number(process.argv[2] ?? 0)
const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
try {
  const asOf = new Date()
  const cands = await loadCandidates(db, {
    profileId: null,
    asOf: asOf.toISOString(),
    minTemplate: min,
  })
  const ids = rankCandidates(cands, { asOf, signalCount: 0, profileTopics: [] })
  const byId = new Map(cands.map((c) => [c.id, c]))
  const ages = ids.map((id) => (asOf.getTime() - byId.get(id)!.publishedAt.getTime()) / 864e5)
  console.log({
    minTemplate: min,
    items: ids.length,
    top20AgeDays: ages.slice(0, 20).map((a) => +a.toFixed(1)),
  })
} finally {
  await close()
}
