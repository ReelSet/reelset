import { errorFields } from '@reelset/core'
import { AVATAR_MAX_BYTES } from '@/lib/profile-edit'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { removeAvatar, saveAvatar, type EditResult } from '@/server/profile-edit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS = { invalid: 400, too_large: 413, unsupported: 415, rate_limited: 429 } as const

function respond(result: EditResult) {
  if (result.ok) return Response.json({ ok: true })
  return Response.json({ error: result.error }, { status: STATUS[result.error] })
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? 0) > AVATAR_MAX_BYTES) return null
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > AVATAR_MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function POST(request: Request) {
  const log = routeLog('api/profile/avatar')
  try {
    const user = await requireUser('/profile')
    const body = await readBody(request)
    if (!body) return respond({ ok: false, error: 'too_large' })
    return respond(await saveAvatar(getDb(), user.id, body, log))
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'avatar upload failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}

export async function DELETE() {
  const log = routeLog('api/profile/avatar')
  try {
    const user = await requireUser('/profile')
    return respond(await removeAvatar(getDb(), user.id, log))
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'avatar remove failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
