import { errorFields, type Logger } from '@reelset/core'
import { CONTAINER_BASE_URL } from './constants'
import type { ContainerFetcher } from './container-client'

export type BoxFetcherConfig = { baseUrl: string; token: string; log: Logger }

const AUTH_REJECTED_STATUSES = new Set([401, 403])

/** Sends `http://container/<path>` requests to the render box with the bearer token, keeping method, body, headers and signal. */
export function createBoxFetcher(config: BoxFetcherConfig): ContainerFetcher {
  const base = new URL(config.baseUrl)
  const internalOrigin = new URL(CONTAINER_BASE_URL).origin
  return {
    async fetch(request) {
      const source = new URL(request.url)
      if (source.origin !== internalOrigin) {
        throw new Error(`box fetcher only serves ${internalOrigin}, got ${source.origin}`)
      }
      const target = new URL(`${source.pathname}${source.search}`, base)
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${config.token}`)
      const body = request.body === null ? undefined : await request.arrayBuffer()
      try {
        const res = await fetch(target, {
          method: request.method,
          headers,
          body,
          signal: request.signal,
        })
        if (AUTH_REJECTED_STATUSES.has(res.status)) {
          config.log.error(
            { path: source.pathname, status: res.status },
            'render box rejected token',
          )
        }
        return res
      } catch (err) {
        config.log.warn({ path: source.pathname, ...errorFields(err) }, 'render box unreachable')
        throw err
      }
    },
  }
}
