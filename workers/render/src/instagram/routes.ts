import { z } from 'zod'
import { errorFields, type Logger } from '@reelset/core'
import { isAuthorized } from './auth'
import {
  checkActiveAccount,
  connectActiveAccount,
  disconnectActiveAccount,
  type IgDeps,
} from './service'

export const IG_ROUTE_PREFIX = '/admin/ig/'
export const IG_RUN_QUEUE = 'instagram-run'

export type IgRunMessage = { reason: 'poke' | 'cron' }

export type IgRoute = 'status' | 'connect' | 'disconnect' | 'run' | 'not_found'

const ROUTES: readonly IgRoute[] = ['status', 'connect', 'disconnect', 'run']

export function matchIgRoute(method: string, pathname: string): IgRoute {
  if (method !== 'POST' || !pathname.startsWith(IG_ROUTE_PREFIX)) return 'not_found'
  const name = pathname.slice(IG_ROUTE_PREFIX.length)
  return ROUTES.find((r) => r === name) ?? 'not_found'
}

const connectBodySchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{6,8}$/)
      .optional(),
    username: z.string().trim().min(1).max(64).optional(),
    password: z.string().min(1).max(256).optional(),
    totpSecret: z
      .string()
      .trim()
      .regex(/^[A-Z2-7 =]{16,128}$/i)
      .optional(),
    accessToken: z
      .string()
      .trim()
      .regex(/^\S{20,2000}$/)
      .optional(),
  })
  .refine((b) => Boolean(b.username) === Boolean(b.password), {
    message: 'username and password go together',
  })
  .refine((b) => !(b.accessToken && (b.username || b.code)), {
    message: 'an access token is saved on its own',
  })

export type IgRouteContext = {
  token: string | undefined
  withDeps: <T>(fn: (deps: IgDeps) => Promise<T>) => Promise<T>
  /**
   * Hands the queue run to the `instagram-run` queue consumer. An upload takes 30-60s and a
   * fetch's waitUntil is cut ~30s after the response, which killed uploads mid-flight (live on
   * Instagram, never recorded); a queue consumer gets up to 15 minutes.
   */
  enqueueRun: (message: IgRunMessage) => Promise<void>
  log: Logger
}

export async function handleIgRoute(
  route: Exclude<IgRoute, 'not_found'>,
  request: Request,
  ctx: IgRouteContext,
): Promise<Response> {
  if (!(await isAuthorized(request, ctx.token))) {
    ctx.log.warn({ route }, 'instagram admin route rejected')
    return new Response('not found', { status: 404 })
  }
  try {
    if (route === 'status') return Response.json(await ctx.withDeps(checkActiveAccount))
    if (route === 'connect') {
      const body = connectBodySchema.safeParse(await request.json().catch(() => ({})))
      if (!body.success) return Response.json({ error: 'invalid input' }, { status: 400 })
      const { code, username, password, totpSecret, accessToken } = body.data
      const creds =
        username && password
          ? {
              username: username.replace(/^@/, ''),
              password,
              ...(totpSecret ? { totpSecret: totpSecret.replace(/\s+/g, '').toUpperCase() } : {}),
            }
          : undefined
      ctx.log.info(
        { newCreds: Boolean(creds), code: Boolean(code), accessToken: Boolean(accessToken) },
        'instagram connect requested',
      )
      return Response.json(
        await ctx.withDeps((deps) => connectActiveAccount(deps, { code, creds, accessToken })),
      )
    }
    if (route === 'disconnect') return Response.json(await ctx.withDeps(disconnectActiveAccount))
    await ctx.enqueueRun({ reason: 'poke' })
    ctx.log.info('instagram queue run enqueued')
    return Response.json({ accepted: true }, { status: 202 })
  } catch (err) {
    ctx.log.error({ route, ...errorFields(err) }, 'instagram admin route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
