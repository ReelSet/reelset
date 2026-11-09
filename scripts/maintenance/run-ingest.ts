import { createDb, createLogger, type Source } from '@reelset/core'
import { runIngest } from '../../workers/ingest/src/ingest/run'

const sources = process.argv.slice(2) as Source[]
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 2 })
try {
  const summary = await runIngest(
    { db, log, env: { githubToken: process.env.GITHUB_TOKEN } },
    { sources: sources.length > 0 ? sources : undefined },
  )
  console.log(summary.mode, 'fetched', summary.fetched, 'inserted', summary.inserted)
} finally {
  await close()
}
