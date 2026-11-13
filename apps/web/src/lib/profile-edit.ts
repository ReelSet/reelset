import { z } from 'zod'

export const NAME_MAX = 40
export const BIO_MAX = 160
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_SIZE = 256
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const EDITS_PER_HOUR = 20

export const profileDetailsSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  bio: z
    .string()
    .trim()
    .max(BIO_MAX)
    .nullish()
    .transform((v) => v || null),
})

export type ViewerIdentity = {
  name: string
  bio: string | null
  avatarUrl: string | null
  initial: string
  hasCustomName: boolean
  hasCustomAvatar: boolean
}

type IdentityInput = {
  profileId: string
  email: string | null
  providerName: string | null
  providerAvatar: string | null
  displayName: string | null
  bio: string | null
  avatarHidden: boolean
  avatarUpdatedAt: Date | string | null
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

export function providerProfile(metadata: Record<string, unknown> | null | undefined) {
  const m = metadata ?? {}
  let name: string | null = null
  for (const key of ['full_name', 'name', 'user_name', 'preferred_username']) {
    const v = m[key]
    if (typeof v === 'string' && v.trim()) {
      name = v.trim().slice(0, NAME_MAX)
      break
    }
  }
  return { name, avatar: httpsUrl(m['avatar_url'] ?? m['picture']) }
}

export function avatarPath(profileId: string, updatedAt: Date | string): string {
  return `/api/avatar/${profileId}?v=${new Date(updatedAt).getTime()}`
}

export function resolveIdentity(input: IdentityInput): ViewerIdentity {
  const emailName = input.email ? input.email.split('@')[0]! : null
  const name = input.displayName || input.providerName || emailName || 'Reelset user'
  const custom = input.avatarUpdatedAt ? avatarPath(input.profileId, input.avatarUpdatedAt) : null
  return {
    name,
    bio: input.bio,
    avatarUrl: custom ?? (input.avatarHidden ? null : input.providerAvatar),
    initial: name.trim().charAt(0).toUpperCase() || '?',
    hasCustomName: Boolean(input.displayName),
    hasCustomAvatar: Boolean(custom),
  }
}

/** Identifies an image by magic bytes so the declared Content-Type is never trusted. */
export function sniffImageType(bytes: Uint8Array): (typeof AVATAR_TYPES)[number] | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b)
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}
