import { createLogger } from '@reelset/core'
import { redditAdapter } from '../../workers/ingest/src/sources/reddit'
const log = createLogger({ app: 'smoke', level: 'warn' })
const subs = ['devops', 'programming', 'webdev']
for (const s of subs) {
  const ctx: any = { mode: 'incremental', range: { after: new Date(Date.now() - 3 * 864e5), before: null }, maxPages: 1, hostIntervalMs: 500, deadlineAt: performance.now() + 60000, now: new Date(), settings: {} }
  try {
    const r = await redditAdapter.fetch(s, log, ctx)
    console.log(s, 'mentions', r.mentions.length, 'sample', r.mentions[0]?.title?.slice(0, 60))
  } catch (e: any) { console.log(s, 'ERR', e.message) }
}
