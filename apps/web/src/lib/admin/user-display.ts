import { avatarPath } from '@/lib/avatar-path'

// Client-safe user display helpers (no zod), shared by the users list and the user drawer.

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email',
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
}

export function providerLabel(provider: string | null): string {
  if (!provider) return '-'
  return PROVIDER_LABELS[provider] ?? provider
}

export type UserIdentityInput = {
  displayName: string | null
  providerName: string | null
  handle: string | null
  email: string | null
}

export function userDisplay(input: UserIdentityInput): {
  name: string
  handle: string | null
  initial: string
} {
  const emailName = input.email?.split('@')[0] || null
  const name = input.displayName || input.providerName || emailName || 'Unknown'
  return {
    name,
    handle: input.handle ? `@${input.handle}` : null,
    initial: name.trim().charAt(0).toUpperCase() || '?',
  }
}

export type UserAvatarInput = {
  id: string
  avatar_updated_at: Date | string | null
  avatar_hidden: boolean
  provider_avatar: string | null
}

export function userAvatarUrl(user: UserAvatarInput): string | null {
  if (user.avatar_updated_at) return avatarPath(user.id, user.avatar_updated_at)
  if (user.avatar_hidden || !user.provider_avatar?.startsWith('https://')) return null
  return user.provider_avatar
}
