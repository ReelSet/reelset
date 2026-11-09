import { UserRole, errorFields } from '@reelset/core'
import { isAdminEmail } from '@/lib/auth/admin-emails'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { getDb } from './db'
import { log } from './logger'
import { createSupabaseServerClient } from './supabase'

export type AuthUser = { id: string; email: string | null }

export class UnauthorizedError extends Error {
  constructor(readonly loginUrl: string) {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
    this.name = 'ForbiddenError'
  }
}

const knownProfiles = new Set<string>()

export async function ensureProfile(userId: string, email: string | null = null): Promise<void> {
  const admin = isAdminEmail(email, process.env.ADMIN_EMAILS)
  const key = admin ? `${userId}:admin` : userId
  if (knownProfiles.has(key)) return
  const db = getDb()
  if (admin) {
    await db
      .insertInto('profile')
      .values({ id: userId, role: UserRole.admin })
      .onConflict((oc) => oc.column('id').doUpdateSet({ role: UserRole.admin }))
      .execute()
    log.info({ profileId: userId }, 'admin profile ensured')
  } else {
    await db
      .insertInto('profile')
      .values({ id: userId })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()
    log.debug({ profileId: userId }, 'profile ensured')
  }
  knownProfiles.add(key)
}

export async function getOptionalUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const user: AuthUser = { id: data.user.id, email: data.user.email ?? null }
  try {
    await ensureProfile(user.id, user.email)
  } catch (err) {
    log.error({ profileId: user.id, ...errorFields(err) }, 'profile upsert failed')
    throw err
  }
  return user
}

export async function requireUser(returnTo = '/'): Promise<AuthUser> {
  const user = await getOptionalUser()
  if (!user) throw new UnauthorizedError(buildLoginUrl(returnTo))
  return user
}

export async function getUserRole(userId: string): Promise<UserRole | null> {
  const row = await getDb()
    .selectFrom('profile')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirst()
  return row?.role ?? null
}

export async function requireAdmin(returnTo = '/admin'): Promise<AuthUser> {
  const user = await requireUser(returnTo)
  if ((await getUserRole(user.id)) !== UserRole.admin) throw new ForbiddenError()
  return user
}

export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof UnauthorizedError) {
    return Response.json({ error: 'unauthorized', loginUrl: err.loginUrl }, { status: 401 })
  }
  if (err instanceof ForbiddenError) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  return null
}
