import { API_CATALOG_CONTENT_TYPE, buildApiCatalog } from '@/lib/seo/agent-discovery'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(buildApiCatalog(), {
    headers: {
      'content-type': API_CATALOG_CONTENT_TYPE,
      'cache-control': 'public, s-maxage=86400',
      'access-control-allow-origin': '*',
    },
  })
}
