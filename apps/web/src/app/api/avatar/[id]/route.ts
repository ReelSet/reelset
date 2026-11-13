import { z } from 'zod'
import { getDb } from '@/server/db'
import { loadAvatar } from '@/server/profile-edit'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 })
  const avatar = await loadAvatar(getDb(), id)
  if (!avatar) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      'content-type': avatar.content_type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}
