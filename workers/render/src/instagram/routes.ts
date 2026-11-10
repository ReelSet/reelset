import { z } from 'zod'
import { errorFields, type Logger } from '@reelset/core'
import { isAuthorized } from './auth'
import { checkAccount, connectAccount, runInstagramQueue, type IgDeps } from './service'

export const IG_ROUTE_PREFIX = '/admin/ig/'

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
  waitUntil: (promise: Promise<unknown>) => void
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
    ctx.waitUntil(
      ctx
        .withDeps(runInstagramQueue)
        .catch((err) => ctx.log.error(errorFields(err), 'instagram queue run failed')),
    )
    return Response.json({ accepted: true }, { status: 202 })
  } catch (err) {
    ctx.log.error({ route, ...errorFields(err) }, 'instagram admin route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
