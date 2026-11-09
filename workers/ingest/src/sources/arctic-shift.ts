import { elapsedMs, type Logger } from '@reelset/core'
import {
  ARCTIC_ATTEMPTS,
  ARCTIC_BASE_URL,
  ARCTIC_RETRYABLE_STATUSES,
  ARCTIC_TIMEOUT_MS,
  USER_AGENT,
} from '../config'
import { fetchJson } from '../http'

type ArcticEnvelope<T> = { data?: T; error?: string }

export async function arcticGet<T>(
  path: string,
  params: Record<string, string>,
  log: Logger,
  hostIntervalMs: number,
): Promise<T> {
  const url = `${ARCTIC_BASE_URL}${path}?${new URLSearchParams(params).toString()}`
  const startedAt = performance.now()

  const payload = await fetchJson<ArcticEnvelope<T>>(url, log, {
    headers: { 'user-agent': USER_AGENT },
    timeoutMs: ARCTIC_TIMEOUT_MS,
    attempts: ARCTIC_ATTEMPTS,
    hostIntervalMs,
    extraRetryableStatuses: ARCTIC_RETRYABLE_STATUSES,
    retryAfterHeader: 'x-ratelimit-reset',
  })

  if (payload.error) throw new Error(`arctic shift ${path} failed: ${payload.error}`)
  if (payload.data === undefined) throw new Error(`arctic shift ${path} returned no data field`)

  log.debug({ path, durationMs: elapsedMs(startedAt) }, 'arctic shift ok')
  return payload.data
}
