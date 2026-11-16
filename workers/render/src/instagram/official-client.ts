import { z } from 'zod'
import type { Logger } from '@reelset/core'

// Instagram API with Unified Login: a Business Integration System User access token on
// graph.facebook.com, with the Instagram account id in every path. No Facebook Page is needed.
export const IG_GRAPH_HOST = 'https://graph.facebook.com'
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

const TOKEN_CODES = new Set([102, 190])
const PERMISSION_CODES = new Set([3, 10, 200])
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002])
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
export type MediaStats = {
  id: string
  shortcode: string | null
  permalink: string | null
  likes: number | null
  comments: number | null
}
export type MediaPage = { media: MediaStats[]; next: string | null }
export type MediaInsights = {
  views: number | null
  reach: number | null
  saves: number | null
  shares: number | null
}
// Reel metric names in v27.0 media insights; they need the instagram_manage_insights permission.
export const REEL_INSIGHT_METRICS = ['views', 'reach', 'saved', 'shares'] as const
export const MEDIA_PAGE_SIZE = 50

/** `expiresAt` is null for a token that never expires. */
export type TokenInfo = { valid: boolean; expiresAt: Date | null; scopes: string[] }
export type MetaApp = { id: string; secret: string }

export type OfficialClient = {
  /** True when the Meta app id and secret are configured: expiry can be read and tokens refreshed. */
  canManageTokens: boolean
  /** The Instagram accounts shared with the token; `/me` itself is the system user. */
  listAccounts(token: string): Promise<OfficialAccount[]>
  getClientBusinessId(token: string): Promise<string | null>
  createReelContainer(token: string, igId: string, reel: OfficialReel): Promise<string>
  getContainerStatus(token: string, containerId: string): Promise<ContainerStatus>
  publish(token: string, igId: string, containerId: string): Promise<string>
  getPublishingLimit(token: string, igId: string): Promise<PublishingLimit>
  getPermalink(token: string, mediaId: string): Promise<string>
  listMediaSince(token: string, igId: string, since: Date): Promise<OfficialMedia[]>
  /** One page of the account's media with likes and comments, newest first; `next` is the cursor. */
  listMediaStats(token: string, igId: string, after: string | null): Promise<MediaPage>
  getMediaInsights(token: string, mediaId: string): Promise<MediaInsights>
  deleteMedia(token: string, mediaId: string): Promise<boolean>
  inspectToken(token: string): Promise<TokenInfo>
  /** Asks the token management API for a new token for the same business; returns it. */
  refreshToken(token: string, clientBusinessId: string): Promise<string>
}

const idSchema = z.object({ id: z.string().min(1) })
const accountsSchema = z.object({
  data: z.array(z.object({ id: z.union([z.string(), z.number()]), username: z.string().min(1) })),
})
const businessSchema = z.object({
  client_business_id: z.union([z.string(), z.number()]).optional(),
})
const deleteSchema = z.object({ success: z.boolean() })
const debugSchema = z.object({
  data: z.object({
    is_valid: z.boolean(),
    expires_at: z.number().optional(),
    scopes: z.array(z.string()).optional(),
  }),
})
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
const mediaStatsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      shortcode: z.string().optional(),
      permalink: z.string().optional(),
      like_count: z.number().optional(),
      comments_count: z.number().optional(),
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
})
const insightsSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.object({ value: z.number().optional() })).optional(),
      total_value: z.object({ value: z.number().optional() }).optional(),
    }),
  ),
})
const refreshSchema = z.object({ access_token: z.string().min(1) })

async function appSecretProof(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token)))
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type CallInput = {
  op: string
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  /** Sent as the Authorization header, so it never appears in a URL. */
  token: string
  query?: Record<string, string>
  body?: Record<string, unknown>
  timeoutMs: number
}

const NO_APP_MESSAGE = 'META_APP_ID and META_APP_SECRET are not configured'

export function createOfficialClient(
  fetchImpl: typeof fetch,
  log: Logger,
  app: MetaApp | null = null,
): OfficialClient {
  async function call<T>(input: CallInput, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(`${IG_GRAPH_HOST}${input.path}`)
    for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, v)
    const headers: Record<string, string> = { authorization: `Bearer ${input.token}` }
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
    canManageTokens: app !== null,

    async listAccounts(token) {
      const raw = await call(
        {
          op: 'assigned_accounts',
          method: 'GET',
          path: `${v}/me/assigned_instagram_accounts`,
          token,
          query: { fields: 'id,username', limit: '100' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        accountsSchema,
      )
      return raw.data.map((a) => ({ userId: String(a.id), username: a.username }))
    },

    async getClientBusinessId(token) {
      const raw = await call(
        {
          op: 'client_business',
          method: 'GET',
          path: `${v}/me`,
          token,
          query: { fields: 'client_business_id' },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        businessSchema,
      )
      return raw.client_business_id === undefined ? null : String(raw.client_business_id)
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

    async listMediaStats(token, igId, after) {
      const raw = await call(
        {
          op: 'list_media_stats',
          method: 'GET',
          path: `${v}/${igId}/media`,
          token,
          query: {
            fields: 'id,shortcode,permalink,like_count,comments_count',
            limit: String(MEDIA_PAGE_SIZE),
            ...(after ? { after } : {}),
          },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        mediaStatsSchema,
      )
      return {
        media: raw.data.map((m) => ({
          id: m.id,
          shortcode: m.shortcode ?? null,
          permalink: m.permalink ?? null,
          likes: m.like_count ?? null,
          comments: m.comments_count ?? null,
        })),
        // `paging.next` is a full URL carrying the token, so only the cursor is passed on.
        next: raw.paging?.next ? (raw.paging.cursors?.after ?? null) : null,
      }
    },

    async getMediaInsights(token, mediaId) {
      const raw = await call(
        {
          op: 'media_insights',
          method: 'GET',
          path: `${v}/${mediaId}/insights`,
          token,
          query: { metric: REEL_INSIGHT_METRICS.join(',') },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        insightsSchema,
      )
      const metric = (name: (typeof REEL_INSIGHT_METRICS)[number]) => {
        const row = raw.data.find((m) => m.name === name)
        return row?.values?.[0]?.value ?? row?.total_value?.value ?? null
      }
      return {
        views: metric('views'),
        reach: metric('reach'),
        saves: metric('saved'),
        shares: metric('shares'),
      }
    },

    async deleteMedia(token, mediaId) {
      const raw = await call(
        {
          op: 'delete_media',
          method: 'DELETE',
          path: `${v}/${mediaId}`,
          token,
          timeoutMs: OFFICIAL_TIMEOUT_MS.write,
        },
        deleteSchema,
      )
      return raw.success
    },

    // debug_token takes the inspected token as a query parameter only; URLs are never logged.
    async inspectToken(token) {
      if (!app) throw new OfficialApiError('rejected', NO_APP_MESSAGE, true)
      const raw = await call(
        {
          op: 'debug_token',
          method: 'GET',
          path: `${v}/debug_token`,
          token: `${app.id}|${app.secret}`,
          query: { input_token: token },
          timeoutMs: OFFICIAL_TIMEOUT_MS.read,
        },
        debugSchema,
      )
      const expires = raw.data.expires_at ?? 0
      return {
        valid: raw.data.is_valid,
        expiresAt: expires > 0 ? new Date(expires * 1000) : null,
        scopes: raw.data.scopes ?? [],
      }
    },

    async refreshToken(token, clientBusinessId) {
      if (!app) throw new OfficialApiError('rejected', NO_APP_MESSAGE, true)
      const raw = await call(
        {
          op: 'refresh_token',
          method: 'POST',
          path: `${v}/${clientBusinessId}/system_user_access_tokens`,
          token,
          body: { appsecret_proof: await appSecretProof(token, app.secret) },
          timeoutMs: OFFICIAL_TIMEOUT_MS.write,
        },
        refreshSchema,
      )
      return raw.access_token
    },
  }
}
