import { providerProfile } from '@/lib/profile-edit'

export type SignupInfo = {
  profileId: string
  email: string | null
  name: string
  provider: string | null
}

export type SignupSource = {
  id: string
  email?: string | null
  app_metadata?: Record<string, unknown> | null
  user_metadata?: Record<string, unknown> | null
}

const UNKNOWN_NAME = 'Unknown'

export function signupInfoFrom(user: SignupSource): SignupInfo {
  const email = user.email ?? null
  const provider = user.app_metadata?.provider
  return {
    profileId: user.id,
    email,
    name: providerProfile(user.user_metadata).name ?? email?.split('@')[0] ?? UNKNOWN_NAME,
    provider: typeof provider === 'string' && provider ? provider : null,
  }
}
