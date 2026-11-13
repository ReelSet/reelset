import { cache } from 'react'
import { resolveIdentity } from '@/lib/profile-edit'
import { getOptionalUser } from './auth'
import { getDb } from './db'
import { loadIdentityRow } from './profile-edit'

export const getViewer = cache(async () => {
  const user = await getOptionalUser()
  if (!user) return null
  const row = await loadIdentityRow(getDb(), user.id)
  const identity = resolveIdentity({
    profileId: user.id,
    email: user.email,
    providerName: user.providerName ?? null,
    providerAvatar: user.providerAvatar ?? null,
    displayName: row?.display_name ?? null,
    bio: row?.bio ?? null,
    avatarHidden: row?.avatar_hidden ?? false,
    avatarUpdatedAt: row?.avatar_updated_at ?? null,
  })
  return { user, identity }
})
