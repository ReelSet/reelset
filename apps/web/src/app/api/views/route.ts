import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, parseSessionId, sessionCookieOptions } from '@/lib/session'
import { parseViewBody, viewerKey } from '@/lib/views'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { recordViews } from '@/server/views'

export const dynamic = 'force-dynamic'

const AUTH_TIMEOUT_MS = 1_500

async function resolveProfileId(log: ReturnType<typeof routeLog>): Promise<string | null> {
  try {
    const user = await Promise.race([
      getOptionalUser(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_TIMEOUT_MS)),
    ])
    return user?.id ?? null
  } catch (err) {
    log.warn(errorFields(err), 'view auth lookup failed, counting as anonymous')
    return null
  }
}

export async function POST(request: Request) {
  const log = routeLog('api/views')
  const raw = await request.text().catch(() => '')
  const body = parseViewBody(raw)
  if (!body.ok) {
    log.warn({ reason: body.reason, bytes: raw.length }, 'view body rejected')
    return Response.json({ error: 'invalid_body', reason: body.reason }, { status: 400 })
  }

  try {
    const store = await cookies()
    const existing = parseSessionId(store.get(SESSION_COOKIE)?.value)
    const sessionId = existing ?? crypto.randomUUID()
    const profileId = await resolveProfileId(log)
    const result = await recordViews(
      getDb(),
      { viewerKey: viewerKey(profileId, sessionId), itemIds: body.itemIds },
      log.child({ sessionId, profileId }),
    )

    const response = Response.json(
      { counted: result.recorded, limited: result.limited },
      { status: result.limited && result.recorded === 0 ? 429 : 202 },
    )
    if (!existing) {
      const { maxAge, httpOnly, sameSite, path, secure } = sessionCookieOptions
      response.headers.append(
        'set-cookie',
        `${SESSION_COOKIE}=${sessionId}; Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`,
      )
    }
    return response
  } catch (err) {
    log.error(errorFields(err), 'views failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
