import { markdownResponse } from '@/lib/markdown-negotiation'
import { AUTH_MD } from '@/lib/seo/agent-discovery'

export const dynamic = 'force-static'

export function GET() {
  const response = markdownResponse(AUTH_MD)
  response.headers.set('cache-control', 'public, s-maxage=86400')
  response.headers.set('access-control-allow-origin', '*')
  return response
}
