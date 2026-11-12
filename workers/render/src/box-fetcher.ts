import { errorFields, type Logger } from '@reelset/core'
import { CONTAINER_BASE_URL } from './constants'
import { isBoxDownResponse, type BoxPower } from './box-power'
import type { ContainerFetcher } from './container-client'

export type BoxFetcherConfig = {
  baseUrl: string
  /** Second box that takes the request when the first is unreachable or down (never on timeout). */
  fallbackUrl?: string
  token: string
  log: Logger
  power?: Pick<BoxPower, 'resume'>
}

const AUTH_REJECTED_STATUSES = new Set([401, 403])

/** Sends `http://container/<path>` requests to the render box with the bearer token, keeping method, body, headers and signal. */
export function createBoxFetcher(config: BoxFetcherConfig): ContainerFetcher {
  const bases = [config.baseUrl, config.fallbackUrl]
    .filter((u): u is string => !!u)
    .map((u) => new URL(u))
  const internalOrigin = new URL(CONTAINER_BASE_URL).origin
  return {
    async fetch(request) {
      const source = new URL(request.url)
      if (source.origin !== internalOrigin) {
        throw new Error(`box fetcher only serves ${internalOrigin}, got ${source.origin}`)
      }
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${config.token}`)
      const body = request.body === null ? undefined : await request.arrayBuffer()
      let lastDown: Response | null = null
      let lastError: unknown = null
      for (const [index, base] of bases.entries()) {
        const target = new URL(`${source.pathname}${source.search}`, base)
        const log = config.log.child({ path: source.pathname, box: base.host, attempt: index })
        try {
          const res = await fetch(target, {
            method: request.method,
            headers,
            body,
            signal: request.signal,
          })
          if (AUTH_REJECTED_STATUSES.has(res.status)) {
            log.error({ status: res.status }, 'render box rejected token')
          }
          if (!isBoxDownResponse(res)) return res
          log.warn({ status: res.status }, 'render box is down')
          lastDown = res
        } catch (err) {
          log.warn(errorFields(err), 'render box unreachable')
          if (isTimeout(err)) throw err
          lastError = err
        }
      }
      if (config.power) return wakeBox(config.power)
      if (lastDown) return lastDown
      throw lastError
    },
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/** A paused or booting box reads as busy: the caller retries later while the resume call brings it up. */
async function wakeBox(power: Pick<BoxPower, 'resume'>): Promise<Response> {
  await power.resume()
  return Response.json({ error: 'busy', message: 'render box is starting' }, { status: 429 })
}
