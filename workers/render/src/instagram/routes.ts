import { z } from 'zod'
import { errorFields, type Logger } from '@reelset/core'
import { isAuthorized } from './auth'
import { checkAccount, connectAccount, type IgDeps } from './service'

export const IG_ROUTE_PREFIX = '/admin/ig/'
export const IG_RUN_QUEUE = 'instagram-run'

export type IgRunMessage = { reason: 'poke' | 'cron' }

export type IgRoute = 'status' | 'connect' | 'run' | 'not_found'

export function matchIgRoute(method: string, pathname: string): IgRoute {
  if (method !== 'POST' || !pathname.startsWith(IG_ROUTE_PREFIX)) return 'not_found'
  const name = pathname.slice(IG_ROUTE_PREFIX.length)
  return name === 'status' || name === 'connect' || name === 'run' ? name : 'not_found'
}

const connectBodySchema = z.object({
  code: z
    .string()
    .regex(/^\d{6,8}$/)
    .optional(),
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
    if (route === 'status') return Response.json(await ctx.withDeps(checkAccount))
    if (route === 'connect') {
      const body = connectBodySchema.safeParse(await request.json().catch(() => ({})))
      if (!body.success) return Response.json({ error: 'invalid code' }, { status: 400 })
      return Response.json(await ctx.withDeps((deps) => connectAccount(deps, body.data.code)))
    }
    await ctx.enqueueRun({ reason: 'poke' })
    ctx.log.info('instagram queue run enqueued')
    return Response.json({ accepted: true }, { status: 202 })
  } catch (err) {
    ctx.log.error({ route, ...errorFields(err) }, 'instagram admin route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
