import { INDEXNOW_KEY } from '@reelset/core'

export const dynamic = 'force-static'

export function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  })
}
