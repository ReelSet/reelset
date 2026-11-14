import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { errorFields } from '@reelset/core'
import { getDb } from '@/server/db'
import { MCP_AUTH_CHALLENGE, authenticateMcp } from '@/server/generate/mcp-auth'
import { createReelsetMcpServer } from '@/server/generate/mcp-server'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function jsonRpcError(status: number, message: string, headers?: HeadersInit): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers },
  )
}

export async function POST(request: Request): Promise<Response> {
  const log = routeLog('api/mcp')
  const db = getDb()
  try {
    const auth = await authenticateMcp(db, request.headers.get('authorization'), log)
    if (!auth.ok) {
      log.info({ reason: auth.reason }, 'mcp auth rejected')
      return jsonRpcError(401, 'Unauthorized: send a reelset API key as a Bearer token.', {
        'www-authenticate': MCP_AUTH_CHALLENGE,
      })
    }
    const l = log.child({ userId: auth.viewer.id, keyId: auth.keyId })
    const server = createReelsetMcpServer({ db, user: auth.viewer, log: l })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return await transport.handleRequest(request)
  } catch (err) {
    log.error(errorFields(err), 'mcp request failed')
    return jsonRpcError(500, 'Internal error')
  }
}

function notAllowed(): Response {
  return jsonRpcError(405, 'Method not allowed: this server is stateless, use POST.', {
    allow: 'POST',
  })
}

export const GET = notAllowed
export const DELETE = notAllowed
