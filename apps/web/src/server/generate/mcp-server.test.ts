import { createLogger, type Database } from '@reelset/core'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./service', () => ({
  createGenerateRequest: vi.fn(),
  getRequestForViewer: vi.fn(),
  listMyRequests: vi.fn(),
  getCredits: vi.fn(),
}))

const { createReelsetMcpServer } = await import('./mcp-server')

async function rpc(body: unknown) {
  const server = createReelsetMcpServer({
    db: {} as Database,
    user: { id: 'u1', email: null, isAdmin: false },
    log: createLogger({ app: 'test', level: 'silent' }),
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const res = await transport.handleRequest(
    new Request('https://reelset.app/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
  )
  return res.json() as Promise<{ result?: { tools?: { name: string }[] } }>
}

describe('reelset mcp server over stateless streamable http', () => {
  it('lists the five tools', async () => {
    const out = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(out.result?.tools?.map((t) => t.name).sort()).toEqual([
      'generate_reel',
      'get_credits',
      'get_reel_status',
      'list_my_reels',
      'publish_reel',
    ])
  })
})
