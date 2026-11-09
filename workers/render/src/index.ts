import { getContainer } from '@cloudflare/containers'
import {
  createDb,
  createLogger,
  recordSpend,
  sendAlert,
  transitionItem,
  type Logger,
} from '@reelset/core'
import { loadRetentionDays, runMaintenance } from './cron'
import { CONTAINER_SLOTS, DEFAULT_MEDIA_BASE_URL } from './constants'
import { processRenderJob } from './consumer'
import type { Env } from './env'
import { handleParsePaper } from './paper-route'
import { handleTranscript, handleYoutubeSearch, matchRoute } from './routes'
import { createMaintenanceStore, createRenderStore } from './store'
import { loadTtsConfig } from './tts-config'

export { ReelContainer } from './container'

function makeLogger(env: Env): Logger {
  return createLogger({ app: 'render', level: (env.LOG_LEVEL as Logger['level']) ?? 'info' })
}

function containerSlots(env: Env) {
  const order = Array.from({ length: CONTAINER_SLOTS }, (_, i) => i)
  const start = Math.floor(Math.random() * CONTAINER_SLOTS)
  return order.map((i) => getContainer(env.REEL_CONTAINER, `slot-${(i + start) % CONTAINER_SLOTS}`))
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const route = matchRoute(request.method, url.pathname)
    if (route === 'not_found') return new Response('not found', { status: 404 })
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
    ctx.waitUntil(
      (async () =>
        runMaintenance({
          store: createMaintenanceStore(db, log),
          media: env.MEDIA,
          alert: (input) => sendAlert(db, env.ALERT_WEBHOOK_URL, input, log),
          retentionDays: () => loadRetentionDays(db, log),
          upgrade: {
            voice: (await loadTtsConfig(db, env, log)).voice,
            send: async (itemIds) => {
              await env.RENDER_JOBS.sendBatch(itemIds.map((itemId) => ({ body: { itemId } })))
            },
          },
          log,
        }))().finally(close),
    )
  },
} satisfies ExportedHandler<Env>
