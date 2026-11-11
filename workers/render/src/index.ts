import {
  createDb,
  createLogger,
  errorFields,
  getSetting,
  recordSpend,
  SETTINGS,
  sendAlert,
  transitionItem,
  type Logger,
  type ReelScript,
} from '@reelset/core'
import { loadRetentionDays, runMaintenance } from './cron'
import { createBoxFetcher } from './box-fetcher'
import { createBoxPower, pauseIdleBox, type BoxPower } from './box-power'
import { DEFAULT_MEDIA_BASE_URL } from './constants'
import { processRenderJob, type JobResult } from './consumer'
import { pickBroll } from './pexels'
import type { Env } from './env'
import { handleParsePaper } from './paper-route'
import { IG_RUN_QUEUE, handleIgRoute, matchIgRoute, type IgRunMessage } from './instagram/routes'
import { igConfigured, withIgDeps } from './instagram/wire'
import { runInstagramQueue } from './instagram/service'
import { createAutoPostDeps, queueAutoInstagramPosts } from './instagram/auto'
import { handleTranscript, handleYoutubeSearch, matchRoute } from './routes'
import { createMaintenanceStore, createRenderStore, type ItemForRender } from './store'
import { loadTtsConfig } from './tts-config'

const INTERNAL_HOST = 'render.internal'

function makeLogger(env: Env): Logger {
  return createLogger({ app: 'render', level: (env.LOG_LEVEL as Logger['level']) ?? 'info' })
}

// One queue run per batch: a run does at most one post, and several pokes coalesce into it.
async function runInstagramBatch(
  env: Env,
  batch: MessageBatch<IgRunMessage>,
  log: Logger,
): Promise<void> {
  const reasons = batch.messages.map((m) => m.body?.reason ?? 'unknown')
  if (!igConfigured(env)) {
    log.warn({ reasons }, 'instagram run skipped: secrets not configured')
    batch.ackAll()
    return
  }
  const container = boxFor(env, log)
  try {
    const outcome = await withIgDeps(env, container, log, runInstagramQueue)
    log.info({ reasons, outcome }, 'instagram queue run done')
  } catch (err) {
    log.error({ reasons, ...errorFields(err) }, 'instagram queue run failed')
  }
  batch.ackAll()
}

function powerFor(env: Env, log: Logger): BoxPower | undefined {
  const { NORTHFLANK_API_TOKEN: apiToken, NORTHFLANK_PROJECT_ID: projectId } = env
  const serviceId = env.NORTHFLANK_SERVICE_ID
  if (!apiToken || !projectId || !serviceId) return undefined
  return createBoxPower({ apiToken, projectId, serviceId, log })
}

function boxFor(env: Env, log: Logger) {
  return createBoxFetcher({
    baseUrl: env.RENDER_BOX_URL,
    token: env.RENDER_BOX_TOKEN ?? '',
    log,
    power: powerFor(env, log),
  })
}

async function applyJobResult(
  env: Env,
  message: Message<unknown>,
  result: JobResult,
  log: Logger,
): Promise<void> {
  if (result.action === 'ack') return message.ack()
  if (result.action === 'retry') return message.retry({ delaySeconds: result.delaySeconds })
  if (result.action === 'dead_letter') return message.retry()
  try {
    await env.RENDER_JOBS.send(result.message, { delaySeconds: result.delaySeconds })
    message.ack()
  } catch (err) {
    log.error(errorFields(err), 'could not re-enqueue deferred job, retrying delivery')
    message.retry({ delaySeconds: result.delaySeconds })
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    const igRoute = matchIgRoute(request.method, url.pathname)
    if (igRoute !== 'not_found') {
      const log = makeLogger(env).child({ route: `ig/${igRoute}` })
      const container = boxFor(env, log)
      return handleIgRoute(igRoute, request, {
        token: env.IG_ADMIN_TOKEN,
        withDeps: (fn) => withIgDeps(env, container, log, fn),
        enqueueRun: async (message) => {
          await env.IG_RUN.send(message)
        },
        log,
      })
    }
    const route = matchRoute(request.method, url.pathname)
    if (route === 'not_found' || url.hostname !== INTERNAL_HOST) {
      return new Response('not found', { status: 404 })
    }
    const log = makeLogger(env).child({ route })
    const container = boxFor(env, log)
    if (route === 'parse_paper') {
      return handleParsePaper(request, {
        media: env.MEDIA,
        publicBase: (env.MEDIA_PUBLIC_BASE_URL ?? DEFAULT_MEDIA_BASE_URL).replace(/\/$/, ''),
        container,
        log,
      })
    }
    return route === 'transcript'
      ? handleTranscript(request, container, log)
      : handleYoutubeSearch(request, container, log)
  },

  async queue(batch, env): Promise<void> {
    const log = makeLogger(env).child({ queue: batch.queue })
    if (batch.queue === IG_RUN_QUEUE) {
      await runInstagramBatch(env, batch as MessageBatch<IgRunMessage>, log)
      return
    }
    const { db, close } = createDb({
      connectionString: env.HYPERDRIVE.connectionString,
      log,
      max: 1,
    })
    try {
      const tts = await loadTtsConfig(db, env, log)
      const deps = {
        store: createRenderStore(db, log),
        box: boxFor(env, log),
        media: env.MEDIA,
        transition: (input: Parameters<typeof transitionItem>[1]) => transitionItem(db, input, log),
        spend: (input: Parameters<typeof recordSpend>[1]) => recordSpend(db, input, log),
        ...tts,
        broll: env.PEXELS_API_KEY
          ? (script: ReelScript, item: ItemForRender) =>
              pickBroll(
                {
                  apiKey: env.PEXELS_API_KEY!,
                  fetch: (url, init) => fetch(url, init),
                  cache: env.MEDIA,
                  log,
                },
                script.beats,
                { source: item.source, title: item.title },
              )
          : undefined,
        log,
      }
      await Promise.all(
        batch.messages.map(async (message) => {
          const result = await processRenderJob(deps, message.body, message.attempts)
          await applyJobResult(env, message, result, log)
        }),
      )
    } finally {
      await close()
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    const log = makeLogger(env).child({ cron: controller.cron })
    const { db, close } = createDb({
      connectionString: env.HYPERDRIVE.connectionString,
      log,
      max: 1,
    })
    if (igConfigured(env)) {
      ctx.waitUntil(
        (async () => {
          const { db: igDb, close: closeIg } = createDb({
            connectionString: env.HYPERDRIVE.connectionString,
            log,
            max: 1,
          })
          try {
            await queueAutoInstagramPosts(createAutoPostDeps(igDb, log), log)
          } catch (err) {
            log.error(errorFields(err), 'instagram auto post failed')
          } finally {
            await closeIg()
          }
          await env.IG_RUN.send({ reason: 'cron' })
        })().catch((err) => log.error(errorFields(err), 'instagram queue run enqueue failed')),
      )
    }
    const power = powerFor(env, log)
    if (power) {
      ctx.waitUntil(
        pauseIdleBox({ boxUrl: env.RENDER_BOX_URL, power, log }).catch((err) =>
          log.error(errorFields(err), 'render box idle check failed'),
        ),
      )
    }
    ctx.waitUntil(
      (async () => {
        const upgradeEnabled = await getSetting(db, SETTINGS.renderUpgradeEnabled, log)
        return runMaintenance({
          store: createMaintenanceStore(db, log),
          media: env.MEDIA,
          alert: (input) => sendAlert(db, env.ALERT_WEBHOOK_URL, input, log),
          retentionDays: () => loadRetentionDays(db, log),
          upgrade: upgradeEnabled
            ? {
                voice: (await loadTtsConfig(db, env, log)).voice,
                send: async (itemIds) => {
                  await env.RENDER_JOBS.sendBatch(itemIds.map((itemId) => ({ body: { itemId } })))
                },
              }
            : undefined,
          log,
        })
      })().finally(close),
    )
  },
} satisfies ExportedHandler<Env>
