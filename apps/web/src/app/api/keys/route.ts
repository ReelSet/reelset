import { createApiKey, listApiKeys, type ApiKeyInfo } from '@reelset/core'
import { z } from 'zod'
import type { ApiKeyDto } from '@/lib/generate/types'
import { getDb } from '@/server/db'
import { apiError, internalError, viewerOrResponse } from '@/server/generate/http'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

const MAX_ACTIVE_KEYS = 10
const bodySchema = z.object({ name: z.string().trim().min(1).max(60).optional() })

export function toKeyDto(key: ApiKeyInfo): ApiKeyDto {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }
}

export async function GET() {
  const log = routeLog('api/keys')
  const viewer = await viewerOrResponse('/profile', log)
  if (viewer instanceof Response) return viewer
  try {
    const keys = await listApiKeys(getDb(), viewer.id)
    return Response.json({ keys: keys.filter((k) => !k.revokedAt).map(toKeyDto) })
  } catch (err) {
    return internalError(log, err)
  }
}

export async function POST(request: Request) {
  const log = routeLog('api/keys')
  const viewer = await viewerOrResponse('/profile', log)
  if (viewer instanceof Response) return viewer
  const body = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!body.success) return apiError('invalid_urls', 'Key name must be 1-60 characters.', 400)
  try {
    const db = getDb()
    const active = (await listApiKeys(db, viewer.id)).filter((k) => !k.revokedAt)
    if (active.length >= MAX_ACTIVE_KEYS) {
      return apiError('too_many_open', `You can have at most ${MAX_ACTIVE_KEYS} active keys.`, 429)
    }
    const { key, token } = await createApiKey(
      db,
      { userId: viewer.id, name: body.data.name ?? 'MCP key' },
      log.child({ userId: viewer.id }),
    )
    return Response.json({ key: toKeyDto(key), token }, { status: 201 })
  } catch (err) {
    return internalError(log, err)
  }
}
