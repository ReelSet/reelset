import { UserRole, errorFields } from '@reelset/core'
import { cache } from 'react'
import { providerProfile } from '@/lib/profile-edit'
import { signupInfoFrom, type SignupInfo } from '@/lib/auth/signup-info'
import { isAdminEmail } from '@/lib/auth/admin-emails'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { runAfterResponse } from './background'
import { getDb } from './db'
import { log } from './logger'
import { notifyNewSignup } from './signup-notify'
import { createSupabaseServerClient } from './supabase'

export type AuthUser = {
  id: string
  email: string | null
  providerName?: string | null
  providerAvatar?: string | null
}

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

/** Creates the profile row on first sight; a signup context also triggers the one-time admin email. */
export async function ensureProfile(
  userId: string,
  email: string | null = null,
  signup?: SignupInfo,
): Promise<void> {
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
    if (signup) runAfterResponse(() => notifyNewSignup(db, signup, log).then(() => undefined), log)
  }
  knownProfiles.add(key)
}

type SessionClaims = {
  sub?: unknown
  email?: unknown
  app_metadata?: Record<string, unknown> | null
  user_metadata?: Record<string, unknown> | null
}

/** Maps verified JWT claims to the user; null when they lack a subject. */
export function userFromClaims(claims: SessionClaims | null | undefined): AuthUser | null {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null
  const provider = providerProfile(claims.user_metadata)
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' && claims.email ? claims.email : null,
    providerName: provider.name,
    providerAvatar: provider.avatar,
  }
}

// getClaims verifies the JWT locally against the cached JWKS (no Auth round trip for asymmetric
// keys); cache() runs it once per render even when layout and page both ask.
export const getOptionalUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data) return null
  const claims = data.claims as SessionClaims
  const user = userFromClaims(claims)
  if (!user) return null
  try {
    await ensureProfile(
      user.id,
      user.email,
      signupInfoFrom({
        id: user.id,
        email: user.email,
        app_metadata: claims.app_metadata,
        user_metadata: claims.user_metadata,
      }),
    )
  } catch (err) {
    log.error({ profileId: user.id, ...errorFields(err) }, 'profile upsert failed')
    throw err
  }
  return user
})

export async function requireUser(returnTo = '/'): Promise<AuthUser> {
  const user = await getOptionalUser()
  if (!user) throw new UnauthorizedError(buildLoginUrl(returnTo))
  return user
}

export const getUserRole = cache(async (userId: string): Promise<UserRole | null> => {
  const row = await getDb()
    .selectFrom('profile')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirst()
  return row?.role ?? null
})

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
