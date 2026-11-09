import { createDb, createLogger, errorFields, type Logger } from '@reelset/core'
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GEMINI_MODEL,
  type Env,
  type IngestItemMessage,
} from './env'
import { createFirecrawlFallback } from './firecrawl'
import { hasAnyWatermark } from './ingest/repo'
import { runIngest } from './ingest/run'
import { handleMessage } from './pipeline/consumer'
import { createEmbedder, createLlmClient } from './pipeline/gemini'
import type { ProcessDeps } from './pipeline/process'
import { createTranscriptClient } from './pipeline/transcript'
import { createPaperClient } from './paper-client'
import { runAlerts } from './reconcile/alerts'
import { reconcile } from './reconcile/reconcile'
import { isAuthorized, runSelfcheck } from './selfcheck'

const INGEST_CRON = '0 * * * *'
const RECONCILE_CRON = '*/5 * * * *'

function makeLogger(env: Env): Logger {
  const level = (env.LOG_LEVEL ?? 'info') as Parameters<typeof createLogger>[0]['level']
  return createLogger({ app: 'reelset-ingest', level })
}

async function withDb<T>(
  env: Env,
  log: Logger,
  fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>,
) {
  const handle = createDb({ connectionString: env.HYPERDRIVE.connectionString, log, max: 1 })
  try {
    return await fn(handle.db)
  } finally {
    await handle.close()
  }
}

async function onIngestCron(env: Env, log: Logger): Promise<void> {
  await withDb(env, log, async (db) => {
    const mode = (await hasAnyWatermark(db)) ? 'incremental' : 'backfill'
    await runIngest(
      {
        db,
        log,
        env: {
          githubToken: env.GITHUB_TOKEN,
          render: env.RENDER,
          scrape: env.FIRECRAWL_API_KEY
            ? createFirecrawlFallback({ apiKey: env.FIRECRAWL_API_KEY, db, log })
            : undefined,
        },
      },
      { mode },
    )
  })
}

async function onReconcileCron(env: Env, log: Logger): Promise<void> {
  await withDb(env, log, async (db) => {
    const embedder = createEmbedder(
      env.GEMINI_API_KEY,
      env.GEMINI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
      log,
    )
    await reconcile(db, { ingest: env.INGEST_ITEMS, render: env.RENDER_JOBS }, log, new Date(), {
      probe: () => embedder.embed(['ping']),
      alertWebhookUrl: env.ALERT_WEBHOOK_URL,
    })
    await runAlerts(db, env.ALERT_WEBHOOK_URL, log)
  })
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/internal/')) return new Response('not found', { status: 404 })
    if (!isAuthorized(request, env.SELFCHECK_TOKEN))
      return new Response('unauthorized', { status: 401 })
    const log = makeLogger(env).child({ route: url.pathname })
    if (url.pathname === '/internal/selfcheck')
      return Response.json(await runSelfcheck(env.RENDER, log))
    const run =
      url.pathname === '/internal/run/reconcile'
        ? onReconcileCron
        : url.pathname === '/internal/run/ingest'
          ? onIngestCron
          : null
    if (!run) return new Response('not found', { status: 404 })
    ctx.waitUntil(run(env, log).catch((err) => log.error(errorFields(err), 'manual run failed')))
    return Response.json({ started: url.pathname })
  },

  async scheduled(controller, env, _ctx) {
    const log = makeLogger(env).child({ cron: controller.cron })
    const startedAt = performance.now()
    try {
      if (controller.cron === INGEST_CRON) await onIngestCron(env, log)
      else if (controller.cron === RECONCILE_CRON) await onReconcileCron(env, log)
      else log.warn('unknown cron expression, ignoring')
      log.info({ durationMs: Math.round(performance.now() - startedAt) }, 'scheduled run complete')
    } catch (err) {
      log.error(errorFields(err), 'scheduled run failed')
      throw err
    }
  },

  async queue(batch: MessageBatch<IngestItemMessage>, env: Env): Promise<void> {
    const log = makeLogger(env).child({ queue: batch.queue })
    if (batch.queue !== 'ingest-items') {
      log.warn('unexpected queue, retrying messages')
      batch.retryAll()
      return
    }
    await withDb(env, log, async (db) => {
      const deps: ProcessDeps = {
        db,
        log,
        llm: createLlmClient(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL, log),
        embedder: createEmbedder(
          env.GEMINI_API_KEY,
          env.GEMINI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
          log,
        ),
        transcripts: createTranscriptClient(env.RENDER, log),
        papers: createPaperClient(env.RENDER, log),
        scrape: env.FIRECRAWL_API_KEY
          ? createFirecrawlFallback({ apiKey: env.FIRECRAWL_API_KEY, db, log })
          : undefined,
        renderQueue: env.RENDER_JOBS,
        geminiModel: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
        embeddingModel: env.GEMINI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
        alertWebhookUrl: env.ALERT_WEBHOOK_URL,
        githubToken: env.GITHUB_TOKEN,
      }
      log.info({ size: batch.messages.length }, 'ingest-items batch start')
      for (const message of batch.messages) await handleMessage(deps, message)
    })
  },
} satisfies ExportedHandler<Env, IngestItemMessage>
