import { z } from 'zod'
import type { Logger } from '@reelset/core'

// Instagram API with Instagram Login: Instagram User access token, no Facebook Page.
export const IG_GRAPH_HOST = 'https://graph.instagram.com'
export const IG_GRAPH_VERSION = 'v27.0'

export const OFFICIAL_TIMEOUT_MS = { read: 30_000, write: 60_000 }

export type OfficialErrorKind =
  | 'token_invalid'
  | 'permission'
  | 'account_restricted'
  | 'rate_limited'
  | 'not_ready'
  | 'container_gone'
  | 'transient'
  | 'network'
  | 'bad_response'
  | 'rejected'

export class OfficialApiError extends Error {
  constructor(
    readonly kind: OfficialErrorKind,
    message: string,
    /** False when no answer came back, so a write may or may not have happened. */
    readonly answered: boolean,
    readonly detail: { status?: number; code?: number; subcode?: number } = {},
  ) {
    super(message)
    this.name = 'OfficialApiError'
  }
}

const metaErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    is_transient: z.boolean().optional(),
    error_user_msg: z.string().optional(),
  }),
})
type MetaError = z.infer<typeof metaErrorSchema>['error']

const TOKEN_CODES = new Set([190])
const PERMISSION_CODES = new Set([3, 10, 200])
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
const TRANSIENT_CODES = new Set([1, 2])
// Subcodes from the Instagram Platform error reference.
const SUBCODE_KIND: Record<number, OfficialErrorKind> = {
  2207042: 'rate_limited',
  2207051: 'rate_limited',
  2207050: 'account_restricted',
  2207027: 'not_ready',
  2207008: 'container_gone',
  2207020: 'container_gone',
  2207001: 'transient',
  2207003: 'transient',
  2207032: 'transient',
  2207053: 'transient',
}

export function classifyMetaError(status: number, error: MetaError | null): OfficialErrorKind {
  const bySubcode = error?.error_subcode ? SUBCODE_KIND[error.error_subcode] : undefined
  if (bySubcode) return bySubcode
  const code = error?.code
  if ((code !== undefined && TOKEN_CODES.has(code)) || status === 401) return 'token_invalid'
  if (code !== undefined && (PERMISSION_CODES.has(code) || (code > 200 && code < 300)))
    return 'permission'
  if ((code !== undefined && RATE_LIMIT_CODES.has(code)) || status === 429) return 'rate_limited'
  if (error?.is_transient || (code !== undefined && TRANSIENT_CODES.has(code)) || status >= 500)
    return 'transient'
  return error ? 'rejected' : 'bad_response'
}

export const CONTAINER_STATUS_CODES = [
  'EXPIRED',
  'ERROR',
  'FINISHED',
  'IN_PROGRESS',
  'PUBLISHED',
] as const
export type ContainerStatusCode = (typeof CONTAINER_STATUS_CODES)[number]

export type OfficialAccount = { userId: string; username: string }
export type OfficialReel = {
  videoUrl: string
  coverUrl: string | null
  caption: string
  aiGenerated: boolean
}
export type ContainerStatus = { statusCode: ContainerStatusCode; status: string | null }
export type PublishingLimit = { used: number; total: number | null }
export type OfficialMedia = {
  id: string
  caption: string | null
  permalink: string | null
  timestamp: Date | null
}
export type RefreshedToken = { accessToken: string; expiresInSeconds: number }

export type OfficialClient = {
  getAccount(token: string): Promise<OfficialAccount>
  createReelContainer(token: string, igId: string, reel: OfficialReel): Promise<string>
  getContainerStatus(token: string, containerId: string): Promise<ContainerStatus>
  publish(token: string, igId: string, containerId: string): Promise<string>
  getPublishingLimit(token: string, igId: string): Promise<PublishingLimit>
  getPermalink(token: string, mediaId: string): Promise<string>
  listMediaSince(token: string, igId: string, since: Date): Promise<OfficialMedia[]>
  refreshToken(token: string): Promise<RefreshedToken>
}

const idSchema = z.object({ id: z.string().min(1) })
const accountFields = z.object({
  user_id: z.union([z.string(), z.number()]).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  username: z.string().min(1),
})
// The get-started guide shows `/me` wrapped in a data array; the API also answers with a bare object.
const accountSchema = z.union([accountFields, z.object({ data: z.array(accountFields).min(1) })])
const statusSchema = z.object({
  status_code: z.enum(CONTAINER_STATUS_CODES),
  status: z.string().optional(),
})
const limitSchema = z.object({
  data: z
    .array(
      z.object({
        quota_usage: z.number(),
        config: z.object({ quota_total: z.number().optional() }).optional(),
      }),
    )
    .min(1),
})
const permalinkSchema = z.object({ permalink: z.string().url() })
const mediaListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      caption: z.string().optional(),
      permalink: z.string().optional(),
      timestamp: z.string().optional(),
    }),
  ),
})
const refreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
})

type CallInput = {
  op: string
  method: 'GET' | 'POST'
  path: string
  token: string
  query?: Record<string, string>
  body?: Record<string, unknown>
  timeoutMs: number
  /** The refresh endpoint is documented with the token as a query parameter only. */
  tokenInQuery?: boolean
}

export function createOfficialClient(fetchImpl: typeof fetch, log: Logger): OfficialClient {
  async function call<T>(input: CallInput, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(`${IG_GRAPH_HOST}${input.path}`)
    for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, v)
    if (input.tokenInQuery) url.searchParams.set('access_token', input.token)
    const headers: Record<string, string> = input.tokenInQuery
      ? {}
      : { authorization: `Bearer ${input.token}` }
    if (input.body) headers['content-type'] = 'application/json'
    let res: Response
    try {
      res = await fetchImpl(url.toString(), {
        method: input.method,
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(input.timeoutMs),
      })
    } catch (err) {
      // The error is logged by name only: fetch errors can quote the request URL.
      const name = err instanceof Error ? err.name : 'unknown'
      log.error({ op: input.op, errorName: name }, 'instagram api call did not complete')
      throw new OfficialApiError('network', 'Could not reach Instagram. It will be retried.', false)
    }
    const payload: unknown = await res.json().catch(() => null)
    const metaError = metaErrorSchema.safeParse(payload)
    if (!res.ok || metaError.success) {
      const error = metaError.success ? metaError.data.error : null
      const kind = classifyMetaError(res.status, error)
      const detail = { status: res.status, code: error?.code, subcode: error?.error_subcode }
      log.warn({ op: input.op, kind, ...detail }, 'instagram api call refused')
      throw new OfficialApiError(
        kind,
        error?.error_user_msg ?? error?.message ?? `Instagram answered ${res.status}`,
        true,
        detail,
      )
    }
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      log.error({ op: input.op, status: res.status }, 'instagram api answer did not validate')
      throw new OfficialApiError('bad_response', 'Instagram sent an unexpected answer', true, {
        status: res.status,
      })
    }
    log.info({ op: input.op, status: res.status }, 'instagram api call')
    return parsed.data
  }

  const v = `/${IG_GRAPH_VERSION}`

  return {
    async getAccount(token) {
      const raw = await call(
        {
          op: 'me',
          method: 'GET',
          path: `${v}/me`,
          token,
          query: { fields: 'user_id,username' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        accountSchema,
      )
      const account = 'data' in raw ? raw.data[0]! : raw
      const userId = account.user_id ?? account.id
      if (userId === undefined)
        throw new OfficialApiError('bad_response', 'Instagram did not return an account id', true)
      return { userId: String(userId), username: account.username }
    },

    async createReelContainer(token, igId, reel) {
      const { id } = await call(
        {
          op: 'create_container',
          method: 'POST',
          path: `${v}/${igId}/media`,
          token,
          body: {
            media_type: 'REELS',
            video_url: reel.videoUrl,
            caption: reel.caption,
            share_to_feed: true,
            ...(reel.coverUrl ? { cover_url: reel.coverUrl } : {}),
            ...(reel.aiGenerated ? { is_ai_generated: true } : {}),
          },
          timeoutMs: OFFICIAL_TIMEOUT_MS.write,
        },
        idSchema,
      )
      return id
    },

    async getContainerStatus(token, containerId) {
      const raw = await call(
        {
          op: 'container_status',
          method: 'GET',
          path: `${v}/${containerId}`,
          token,
          query: { fields: 'status_code,status' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        statusSchema,
      )
      return { statusCode: raw.status_code, status: raw.status ?? null }
    },

    async publish(token, igId, containerId) {
      const { id } = await call(
        {
          op: 'publish',
          method: 'POST',
          path: `${v}/${igId}/media_publish`,
          token,
          body: { creation_id: containerId },
          timeoutMs: OFFICIAL_TIMEOUT_MS.write,
        },
        idSchema,
      )
      return id
    },

    async getPublishingLimit(token, igId) {
      const raw = await call(
        {
          op: 'publishing_limit',
          method: 'GET',
          path: `${v}/${igId}/content_publishing_limit`,
          token,
          query: { fields: 'quota_usage,config' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        limitSchema,
      )
      const row = raw.data[0]!
      return { used: row.quota_usage, total: row.config?.quota_total ?? null }
    },

    async getPermalink(token, mediaId) {
      const raw = await call(
        {
          op: 'permalink',
          method: 'GET',
          path: `${v}/${mediaId}`,
          token,
          query: { fields: 'permalink' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        permalinkSchema,
      )
      return raw.permalink
    },

    async listMediaSince(token, igId, since) {
      const raw = await call(
        {
          op: 'list_media',
          method: 'GET',
          path: `${v}/${igId}/media`,
          token,
          query: {
            fields: 'id,caption,permalink,timestamp',
            since: String(Math.floor(since.getTime() / 1000)),
            limit: '50',
          },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        mediaListSchema,
      )
      return raw.data.map((m) => {
        // Instagram writes offsets as +0000, which is not strict ISO 8601.
        const at = m.timestamp
          ? new Date(m.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
          : null
        return {
          id: m.id,
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
          timestamp: at && !Number.isNaN(at.getTime()) ? at : null,
        }
      })
    },

    async refreshToken(token) {
      const raw = await call(
        {
          op: 'refresh_token',
          method: 'GET',
          path: '/refresh_access_token',
          token,
          tokenInQuery: true,
          query: { grant_type: 'ig_refresh_token' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        refreshSchema,
      )
      return { accessToken: raw.access_token, expiresInSeconds: raw.expires_in }
    },
  }
}
