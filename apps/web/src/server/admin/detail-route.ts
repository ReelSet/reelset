import { errorFields } from '@reelset/core'
import { z } from 'zod'
import { adminApiDenial, adminJson } from '@/server/admin/api-guard'
import { routeLog } from '@/server/logger'

const idSchema = z.guid()

type Context = { params: Promise<{ id: string }> }

/** GET handler for /api/admin/<name>/[id]: admin-only, guid-validated, never cached. */
export function adminDetailRoute<T>(name: string, load: (id: string) => Promise<T | null>) {
  return async function GET(_request: Request, ctx: Context): Promise<Response> {
    const log = routeLog(`api/admin/${name}`)
    const denied = await adminApiDenial(log)
    if (denied) return denied
    const parsed = idSchema.safeParse((await ctx.params).id)
    if (!parsed.success) return adminJson({ error: 'invalid_id' }, 400)
    const id = parsed.data
    try {
      const detail = await load(id)
      if (!detail) return adminJson({ error: 'not_found' }, 404)
      return adminJson(detail)
    } catch (err) {
      log.error({ ...errorFields(err), id }, 'admin detail failed')
      return adminJson({ error: 'internal' }, 500)
    }
  }
}
