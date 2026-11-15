import { errorFields, type Logger } from '@reelset/core'
import { authErrorResponse, requireAdmin } from '@/server/auth'

const NO_STORE = 'private, no-store'

export function adminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': NO_STORE } })
}

/** JSON twin of assertAdmin: 401 for anonymous, 403 for non-admins, null when the caller may proceed. */
export async function adminApiDenial(log: Logger): Promise<Response | null> {
  try {
    await requireAdmin()
    return null
  } catch (err) {
    const denied = authErrorResponse(err)
    if (!denied) {
      log.error(errorFields(err), 'admin api auth check failed')
      return adminJson({ error: 'internal' }, 500)
    }
    log.warn({ status: denied.status }, 'admin api access denied')
    return adminJson(await denied.json(), denied.status)
  }
}
