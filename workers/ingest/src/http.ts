import { elapsedMs, errorFields, type Logger } from '@reelset/core'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}`)
    this.name = 'HttpError'
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 60_000
const JITTER_RATIO = 0.35

// Tests set both scales to 0 so retries do not sleep.
export const httpTuning = { backoffScale: 1, hostIntervalScale: 1 }

const hostSlots = new Map<string, Promise<void>>()

export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|access_token|token)=)[^&]+/gi, '$1[REDACTED]')
}

export function isRetryableStatus(status: number, extra?: readonly number[]): boolean {
  return RETRYABLE.has(status) || (extra?.includes(status) ?? false)
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jittered(ms: number): number {
  const spread = ms * JITTER_RATIO
  return Math.max(0, Math.round(ms - spread + Math.random() * spread * 2))
}

export function backoffMs(attempt: number, retryAfterMs: number | null): number {
  const base = retryAfterMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1)
  return jittered(Math.min(base, MAX_BACKOFF_MS)) * httpTuning.backoffScale
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function throttleHost(url: string, minIntervalMs: number): Promise<void> {
  const interval = minIntervalMs * httpTuning.hostIntervalScale
  if (interval <= 0) return Promise.resolve()
  const host = hostOf(url)
  const previous = hostSlots.get(host) ?? Promise.resolve()
  const next = previous.then(() => sleep(jittered(interval)))
  hostSlots.set(host, next)
  return next
}

export type FetchOptions = {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  attempts?: number
  hostIntervalMs?: number
  extraRetryableStatuses?: readonly number[]
  retryAfterHeader?: string
}

export async function fetchText(
  url: string,
  log: Logger,
  options: FetchOptions = {},
): Promise<string> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 20_000,
    attempts = 3,
    hostIntervalMs = 200,
    extraRetryableStatuses,
    retryAfterHeader = 'retry-after',
  } = options
  const safeUrl = redactUrl(url)
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await throttleHost(url, hostIntervalMs)
    const startedAt = performance.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal })
      const text = await res.text()

      if (!res.ok) {
        const err = new HttpError(res.status, url, text.slice(0, 500))
        if (isRetryableStatus(res.status, extraRetryableStatuses) && attempt < attempts) {
          const waitMs = backoffMs(attempt, parseRetryAfter(res.headers.get(retryAfterHeader)))
          log.warn(
            { url: safeUrl, status: res.status, attempt, backoffMs: waitMs },
            'http retryable failure',
          )
          lastError = err
          await sleep(waitMs)
          continue
        }
        log.error(
          { url: safeUrl, status: res.status, durationMs: elapsedMs(startedAt) },
          'http failed',
        )
        throw err
      }

      log.debug(
        { url: safeUrl, status: res.status, bytes: text.length, durationMs: elapsedMs(startedAt) },
        'http ok',
      )
      return text
    } catch (err) {
      lastError = err
      if (err instanceof HttpError) throw err
      if (attempt >= attempts) {
        log.error({ url: safeUrl, attempt, ...errorFields(err) }, 'http error')
        throw err
      }
      const waitMs = backoffMs(attempt, null)
      log.warn(
        { url: safeUrl, attempt, backoffMs: waitMs, ...errorFields(err) },
        'http error, retrying',
      )
      await sleep(waitMs)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError
}

export async function fetchJson<T = unknown>(
  url: string,
  log: Logger,
  options: FetchOptions = {},
): Promise<T> {
  const text = await fetchText(url, log, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  })
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`invalid JSON from ${hostOf(url)} (${text.slice(0, 80).replace(/\s+/g, ' ')})`)
  }
}
