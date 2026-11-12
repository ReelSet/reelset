import { errorFields, type Logger } from '@reelset/core'
import { BOX_BUSY_STATUS, BOX_HEALTH_TIMEOUT_MS, CONTAINER_BASE_URL } from './constants'
import { isBoxDownResponse } from './box-health'
import type { ContainerFetcher } from './container-client'

export type BoxFetcherConfig = {
  baseUrls: string[]
  token: string
  log: Logger
}

const AUTH_REJECTED_STATUSES = new Set([401, 403])
const RENDER_ASSET_PATH = /^\/render\/[^/]+(\/(video|poster))?$/

type Policy = 'render' | 'lookup' | 'light'

export function parseBoxUrls(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** Every box once, starting at a position fixed by the job id so a job always meets the same box first. */
export function boxOrder<T>(boxes: readonly T[], jobId: string): T[] {
  if (boxes.length === 0) return []
  const start = fnv1a(jobId) % boxes.length
  return [...boxes.slice(start), ...boxes.slice(0, start)]
}

function policyFor(method: string, pathname: string): Policy {
  if (method === 'POST' && pathname === '/render') return 'render'
  const isAsset = method === 'GET' && /^\/render\/[^/]+\/(video|poster)$/.test(pathname)
  const isDelete = method === 'DELETE' && RENDER_ASSET_PATH.test(pathname)
  return isAsset || isDelete ? 'lookup' : 'light'
}

function jobIdFor(policy: Policy, pathname: string, body: ArrayBuffer | undefined): string {
  if (policy === 'lookup') return pathname.split('/')[2] ?? ''
  if (policy === 'render' && body) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
      const jobId = (parsed as { jobId?: unknown } | null)?.jobId
      if (typeof jobId === 'string') return jobId
    } catch {
      // falls through to the empty key
    }
  }
  return ''
}

async function isBusyAnswer(res: Response): Promise<boolean> {
  if (res.status === BOX_BUSY_STATUS) return true
  if (res.status !== 409) return false
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null)
  return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'busy'
}

async function shouldMoveOn(policy: Policy, res: Response): Promise<'down' | 'busy' | null> {
  if (isBoxDownResponse(res)) return 'down'
  if (policy === 'render' && (await isBusyAnswer(res))) return 'busy'
  if (policy === 'lookup' && res.status === 404) return 'busy'
  return null
}

type Logged = Pick<Logger, 'info' | 'warn'>

/**
 * The box that already holds this job (running or finished), so a re-check never starts a
 * duplicate render on another box that has since become free.
 */
export async function findJobOwner(
  bases: readonly URL[],
  jobId: string,
  headers: Headers,
  log: Logged,
): Promise<URL | null> {
  const states = await Promise.all(
    bases.map(async (base) => {
      try {
        const res = await fetch(new URL(`/render/${encodeURIComponent(jobId)}`, base), {
          headers,
          signal: AbortSignal.timeout(BOX_HEALTH_TIMEOUT_MS),
        })
        if (!res.ok) return null
        const body: unknown = await res.json().catch(() => null)
        const state = (body as { state?: unknown } | null)?.state
        return state === 'running' || state === 'done' ? base : null
      } catch {
        return null
      }
    }),
  )
  const owner = states.find((b): b is URL => b !== null) ?? null
  if (owner) log.info({ jobId, box: owner.host }, 'job already held by a box, sending it there')
  return owner
}

/**
 * Sends `http://container/<path>` requests to a pool of render boxes with the bearer token.
 * Renders and job lookups walk the boxes in job-id hash order; light calls try the last box first.
 */
export function createBoxFetcher(config: BoxFetcherConfig): ContainerFetcher {
  const bases = config.baseUrls.map((u) => new URL(u))
  const internalOrigin = new URL(CONTAINER_BASE_URL).origin
  return {
    async fetch(request) {
      const source = new URL(request.url)
      if (source.origin !== internalOrigin) {
        throw new Error(`box fetcher only serves ${internalOrigin}, got ${source.origin}`)
      }
      if (bases.length === 0) throw new Error('no render boxes configured')
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${config.token}`)
      const body = request.body === null ? undefined : await request.arrayBuffer()
      const policy = policyFor(request.method, source.pathname)
      const jobId = jobIdFor(policy, source.pathname, body)
      let ordered = policy === 'light' ? [...bases].reverse() : boxOrder(bases, jobId)
      if (policy === 'render' && jobId && bases.length > 1) {
        const owner = await findJobOwner(bases, jobId, headers, config.log)
        if (owner) ordered = [owner, ...ordered.filter((b) => b !== owner)]
      }

      let lastBusy: Response | null = null
      let lastDown: Response | null = null
      let lastNotFound: Response | null = null
      let lastError: unknown = null
      for (const [index, base] of ordered.entries()) {
        const target = new URL(`${source.pathname}${source.search}`, base)
        const log = config.log.child({ path: source.pathname, box: base.host, attempt: index })
        let res: Response
        try {
          res = await fetch(target, {
            method: request.method,
            headers,
            body,
            signal: request.signal,
          })
        } catch (err) {
          log.warn(errorFields(err), 'render box unreachable')
          if (isTimeout(err)) throw err
          lastError = err
          continue
        }
        if (AUTH_REJECTED_STATUSES.has(res.status)) {
          log.error({ status: res.status }, 'render box rejected token')
        }
        const moveOn = await shouldMoveOn(policy, res)
        if (!moveOn) return res
        if (moveOn === 'down') {
          log.warn({ status: res.status }, 'render box is down')
          lastDown = res
        } else if (policy === 'render') {
          log.info('render box busy with another job, trying the next box')
          lastBusy = res
        } else {
          lastNotFound = res
        }
      }
      const fallback = lastBusy ?? lastNotFound ?? lastDown
      if (fallback) return fallback
      throw lastError
    },
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}
