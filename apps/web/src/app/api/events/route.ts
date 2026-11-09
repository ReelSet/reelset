import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import { parseEventBatch, parseEventBody } from '@/lib/events'
import { SESSION_COOKIE, parseSessionId, sessionCookieOptions } from '@/lib/session'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { isQualifyingCompletion } from '@/lib/ranking/taste'
import { routeLog } from '@/server/logger'
import { scheduleTasteRecompute } from '@/server/taste'

export const dynamic = 'force-dynamic'

const AUTH_TIMEOUT_MS = 2_500

// Analytics must not depend on auth: a slow or failing Supabase lookup records the batch as anonymous.
async function resolveUser(log: ReturnType<typeof routeLog>) {
  try {
    return await Promise.race([
      getOptionalUser(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_TIMEOUT_MS)),
    ])
  } catch (err) {
    log.warn(errorFields(err), 'event auth lookup failed, storing anonymously')
    return null
  }
}

async function insertWithRetry(run: () => Promise<unknown>, log: ReturnType<typeof routeLog>) {
  try {
    await run()
  } catch (err) {
    log.warn(errorFields(err), 'events insert failed, retrying once')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await run()
  }
}

export async function POST(request: Request) {
  const log = routeLog('api/events')
  const raw = await request.text().catch(() => '')
  const body = parseEventBody(raw)
  if (!body.ok) {
    log.warn({ reason: body.reason, bytes: raw.length }, 'event body rejected')
    return Response.json({ error: 'invalid_body', reason: body.reason }, { status: 400 })
  }

  const parsed = parseEventBatch(body.json)
  if (!parsed.ok) {
    log.warn({ issues: parsed.issues }, 'event batch rejected')
    return Response.json({ error: 'invalid_events', issues: parsed.issues }, { status: 400 })
  }

  try {
    const store = await cookies()
    const existing = parseSessionId(store.get(SESSION_COOKIE)?.value)
    const sessionId = existing ?? crypto.randomUUID()
    const user = await resolveUser(log)
    const db = getDb()

    const itemIds = [...new Set(parsed.events.flatMap((e) => (e.itemId ? [e.itemId] : [])))]
    const known = new Set(
      itemIds.length
        ? (await db.selectFrom('item').select('id').where('id', 'in', itemIds).execute()).map(
            (r) => r.id,
          )
        : [],
    )

    const rows = parsed.events.map((e) => ({
      profile_id: user?.id ?? null,
      session_id: sessionId,
      name: e.name,
      item_id: e.itemId && known.has(e.itemId) ? e.itemId : null,
      meta: e.meta ? JSON.stringify(e.meta) : null,
    }))
    await insertWithRetry(() => db.insertInto('event').values(rows).execute(), log)
    log.info({ count: rows.length, sessionId, profileId: user?.id ?? null }, 'events stored')

    const completed = parsed.events.some(
      (e) => e.itemId && known.has(e.itemId) && isQualifyingCompletion(e.name, e.meta),
    )
    if (user && completed) after(() => scheduleTasteRecompute(db, user.id, log))

    const response = Response.json({ accepted: rows.length }, { status: 202 })
    if (!existing) {
      const { maxAge, httpOnly, sameSite, path, secure } = sessionCookieOptions
      response.headers.append(
        'set-cookie',
        `${SESSION_COOKIE}=${sessionId}; Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`,
      )
    }
    return response
  } catch (err) {
    log.error(errorFields(err), 'events insert failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
