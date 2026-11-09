import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { ForbiddenError, UnauthorizedError, requireAdmin, type AuthUser } from '@/server/auth'
import { RETURN_PATH_HEADER, safeReturnPath } from '@/lib/auth/return-url'
import { log } from '@/server/logger'

// Anonymous visitors are sent to login; signed-in non-admins get a 404 so the panel is not advertised.
export async function assertAdmin(): Promise<AuthUser> {
  try {
    const returnTo = safeReturnPath((await headers()).get(RETURN_PATH_HEADER), '/admin')
    return await requireAdmin(returnTo)
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(err.loginUrl)
    if (err instanceof ForbiddenError) {
      log.warn({ reason: err.name }, 'admin access denied')
      notFound()
    }
    throw err
  }
}
