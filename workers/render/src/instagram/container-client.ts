import { z } from 'zod'
import { errorFields, igProxySchema, type Logger } from '@reelset/core'
import { CONTAINER_BASE_URL } from '../constants'
import type { ContainerFetcher } from '../container-client'

export const IG_TIMEOUT_MS = {
  status: 45_000,
  login: 90_000,
  post: 5 * 60_000,
  delete: 90_000,
  find: 60_000,
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
}

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
      throw new IgCallError('unreachable', 'could not reach the poster', false)
    }
    log.info({ action, status: res.status }, 'instagram container call')
    const payload: unknown = await res.json().catch(() => null)
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

  return {
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
