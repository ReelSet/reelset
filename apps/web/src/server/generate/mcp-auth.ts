import { errorFields, findApiKeyByToken, type Database, type Logger } from '@reelset/core'
import { resolveViewer, type Viewer } from './service'

export const MCP_AUTH_CHALLENGE =
  'Bearer realm="reelset", error="invalid_token", error_description="Create an API key at https://reelset.app/profile and send it as Authorization: Bearer rs_live_..."'

export type McpAuth = { ok: true; viewer: Viewer; keyId: string } | { ok: false; reason: string }

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return match?.[1] ?? null
}

export async function authenticateMcp(
  db: Database,
  header: string | null,
  log: Logger,
): Promise<McpAuth> {
  const token = bearerToken(header)
  if (!token) return { ok: false, reason: 'missing bearer token' }
  try {
    const key = await findApiKeyByToken(db, token)
    if (!key) return { ok: false, reason: 'invalid or revoked key' }
    return {
      ok: true,
      viewer: await resolveViewer(db, { id: key.userId, email: null }),
      keyId: key.id,
    }
  } catch (err) {
    log.error(errorFields(err), 'mcp auth lookup failed')
    throw err
  }
}
