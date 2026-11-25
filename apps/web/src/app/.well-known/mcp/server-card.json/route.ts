import { buildMcpServerCard } from '@/server/generate/mcp-card'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(buildMcpServerCard(), {
    headers: {
      'cache-control': 'public, s-maxage=86400',
      'access-control-allow-origin': '*',
    },
  })
}
