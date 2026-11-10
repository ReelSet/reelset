import { getContainer } from '@cloudflare/containers'
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
import { CONTAINER_SLOTS, DEFAULT_MEDIA_BASE_URL } from './constants'
import { processRenderJob } from './consumer'
import { pickBroll } from './pexels'
import type { Env } from './env'
import { handleParsePaper } from './paper-route'
import { handleIgRoute, matchIgRoute } from './instagram/routes'
import { IG_CONTAINER_SLOT, igConfigured, withIgDeps } from './instagram/wire'
import { runInstagramQueue } from './instagram/service'
import { handleTranscript, handleYoutubeSearch, matchRoute } from './routes'
import { createMaintenanceStore, createRenderStore, type ItemForRender } from './store'
import { loadTtsConfig } from './tts-config'

export { ReelContainer } from './container'

const INTERNAL_HOST = 'render.internal'

function makeLogger(env: Env): Logger {
  return createLogger({ app: 'render', level: (env.LOG_LEVEL as Logger['level']) ?? 'info' })
}

function containerSlots(env: Env) {
  const order = Array.from({ length: CONTAINER_SLOTS }, (_, i) => i)
  const start = Math.floor(Math.random() * CONTAINER_SLOTS)
  return order.map((i) => getContainer(env.REEL_CONTAINER, `slot-${(i + start) % CONTAINER_SLOTS}`))
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    const igRoute = matchIgRoute(request.method, url.pathname)
    if (igRoute !== 'not_found') {
      const log = makeLogger(env).child({ route: `ig/${igRoute}` })
      const container = getContainer(env.REEL_CONTAINER, IG_CONTAINER_SLOT)
      return handleIgRoute(igRoute, request, {
        token: env.IG_ADMIN_TOKEN,
        withDeps: (fn) => withIgDeps(env, container, log, fn),
        waitUntil: (p) => ctx.waitUntil(p),
        log,
      })
    }
    const route = matchRoute(request.method, url.pathname)
    if (route === 'not_found' || url.hostname !== INTERNAL_HOST) {
      return new Response('not found', { status: 404 })
    }
    const slot = Math.floor(Math.random() * CONTAINER_SLOTS)
    const container = getContainer(env.REEL_CONTAINER, `slot-${slot}`)
    const log = makeLogger(env).child({ route })
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
    const { db, close } = createDb({
      connectionString: env.HYPERDRIVE.connectionString,
      log,
      max: 1,
    })
    try {
      const tts = await loadTtsConfig(db, env, log)
      const deps = {
        store: createRenderStore(db, log),
        containers: containerSlots(env),
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
          if (result.action === 'ack') message.ack()
          else if (result.action === 'retry') message.retry({ delaySeconds: result.delaySeconds })
          else message.retry()
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
      const container = getContainer(env.REEL_CONTAINER, IG_CONTAINER_SLOT)
      ctx.waitUntil(
        withIgDeps(env, container, log, runInstagramQueue).catch((err) =>
          log.error(errorFields(err), 'instagram queue run failed'),
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
