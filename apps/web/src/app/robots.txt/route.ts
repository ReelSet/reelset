import { buildRobotsTxt } from '@/lib/seo/robots-txt'

export const dynamic = 'force-static'

export function GET() {
  return new Response(buildRobotsTxt(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=86400',
    },
  })
}
