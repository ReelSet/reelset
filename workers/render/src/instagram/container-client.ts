import { z } from 'zod'
import { errorFields, igProxySchema, type Logger } from '@reelset/core'
import { CONTAINER_BASE_URL } from '../constants'
import type { ContainerFetcher } from '../container-client'

export const IG_TIMEOUT_MS = {
  status: 45_000,
  // The box answers a login within 75 s (202 in_progress while it keeps going), under the tunnel's 100 s.
  login: 90_000,
  // Post, delete and find run in the background on the box like login and are polled: each call
  // waits at most 75 s for an answer.
  post: 90_000,
  delete: 90_000,
  find: 90_000,
}

const accountResultSchema = z.object({
  state: z.enum(['connected', 'needs_login', 'needs_code', 'challenge', 'unknown']),
  username: z.string().nullable(),
  message: z.string().nullable(),
  session: z.record(z.string(), z.unknown()).nullable(),
  proxy: igProxySchema,
})
export type IgAccountResult = z.infer<typeof accountResultSchema>

const postResultSchema = z.object({
  mediaPk: z.string(),
  permalink: z.string().url(),
  session: z.record(z.string(), z.unknown()),
  proxy: igProxySchema,
})
export type IgPostResult = z.infer<typeof postResultSchema>

const findResultSchema = z.object({
  found: z.boolean(),
  mediaPk: z.string().optional(),
  permalink: z.string().url().optional(),
  match: z.enum(['caption', 'time']).optional(),
  captionRestored: z.boolean().optional(),
  session: z.record(z.string(), z.unknown()),
  proxy: igProxySchema,
})
export type IgFindResult = z.infer<typeof findResultSchema>

const deleteResultSchema = z.object({
  deleted: z.boolean(),
  session: z.record(z.string(), z.unknown()),
  proxy: igProxySchema,
})

export const IN_PROGRESS = 'in_progress'
export const TIMEOUT = 'timeout'

export type IgSession = Record<string, unknown>
export type IgState = { session: IgSession | null; proxyIndex: number | null }

export class IgCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly reachedContainer: boolean,
  ) {
    super(message)
    this.name = 'IgCallError'
  }
}

export type IgCredentials = { username: string; password: string; totpSecret?: string }

export type IgReelUpload = { videoUrl: string; posterUrl: string | null; caption: string }

export type IgContainerClient = {
  status(state: IgState): Promise<IgAccountResult>
  login(state: IgState, creds: IgCredentials, code?: string): Promise<IgAccountResult>
  post(state: IgState, upload: IgReelUpload): Promise<IgPostResult>
  remove(state: IgState, mediaPk: string): Promise<z.infer<typeof deleteResultSchema>>
  /**
   * Looks for the reel of a lost upload published after `since`: same caption, else the video
   * published soonest after it that is not in `excludeMediaPks` (Instagram can drop captions).
   */
  find(
    state: IgState,
    caption: string,
    since: Date,
    excludeMediaPks: readonly string[],
  ): Promise<IgFindResult>
  /**
   * Whether the box runs Instagram ops as background jobs that a repeat call joins. Only then is a
   * call whose answer was lost (timeout, 524) safe to send again; an older box would upload twice.
   */
  supportsJobs(): Promise<boolean>
}

const IG_JOBS_VERSION = 2

// Cloudflare answers these itself (the tunnel or a 100 s origin timeout) while the box may still be
// uploading, so the outcome is unknown rather than a failure the box reported.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524])

export function createIgContainerClient(fetcher: ContainerFetcher, log: Logger): IgContainerClient {
  async function call<T>(
    action: string,
    body: unknown,
    schema: z.ZodType<T>,
    timeoutMs: number,
  ): Promise<T> {
    let res: Response
    try {
      res = await fetcher.fetch(
        new Request(`${CONTAINER_BASE_URL}/instagram/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      )
    } catch (err) {
      log.error({ action, ...errorFields(err) }, 'instagram container call failed')
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
        throw new IgCallError(TIMEOUT, 'the poster did not answer in time', false)
      throw new IgCallError('unreachable', 'could not reach the poster', false)
    }
    log.info({ action, status: res.status }, 'instagram container call')
    const payload: unknown = await res.json().catch(() => null)
    if (
      res.status === 202 &&
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      payload.error === IN_PROGRESS
    )
      throw new IgCallError(IN_PROGRESS, 'the poster is still working', true)
    const hasError = typeof payload === 'object' && payload !== null && 'error' in payload
    if (!res.ok && !hasError && GATEWAY_STATUSES.has(res.status)) {
      throw new IgCallError('gateway', `poster gateway returned ${res.status}`, false)
    }
    if (!res.ok) {
      const code =
        typeof payload === 'object' && payload !== null && 'error' in payload
          ? String(payload.error)
          : 'container_error'
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String(payload.message)
          : `poster returned ${res.status}`
      throw new IgCallError(code, message, true)
    }
    const parsed = schema.safeParse(payload)
    if (!parsed.success)
      throw new IgCallError('bad_response', 'poster response did not validate', true)
    return parsed.data
  }

  async function supportsJobs(): Promise<boolean> {
    try {
      const res = await fetcher.fetch(
        new Request(`${CONTAINER_BASE_URL}/health`, { signal: AbortSignal.timeout(10_000) }),
      )
      const body: unknown = await res.json().catch(() => null)
      const version = (body as { igJobs?: unknown } | null)?.igJobs
      const ok = typeof version === 'number' && version >= IG_JOBS_VERSION
      log.info({ igJobs: version ?? null, ok }, 'instagram box job support checked')
      return ok
    } catch (err) {
      log.warn(errorFields(err), 'instagram box health check failed')
      return false
    }
  }

  return {
    supportsJobs,
    status: (state) => call('status', state, accountResultSchema, IG_TIMEOUT_MS.status),
    login: (state, creds, code) =>
      call('login', { ...state, ...creds, code }, accountResultSchema, IG_TIMEOUT_MS.login),
    post: (state, upload) =>
      call('post', { ...state, ...upload }, postResultSchema, IG_TIMEOUT_MS.post),
    remove: (state, mediaPk) =>
      call('delete', { ...state, mediaPk }, deleteResultSchema, IG_TIMEOUT_MS.delete),
    find: (state, caption, since, excludeMediaPks) =>
      call(
        'find',
        {
          ...state,
          caption,
          since: Math.floor(since.getTime() / 1000),
          excludeMediaPks,
        },
        findResultSchema,
        IG_TIMEOUT_MS.find,
      ),
  }
}
