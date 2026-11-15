import type { NextConfig } from 'next'

const DEFAULT_MEDIA_BASE = 'https://media.reelset.app'

function mediaHost(): string {
  try {
    return new URL(process.env.MEDIA_PUBLIC_BASE_URL || DEFAULT_MEDIA_BASE).hostname
  } catch {
    return new URL(DEFAULT_MEDIA_BASE).hostname
  }
}

const config: NextConfig = {
  transpilePackages: ['@reelset/core'],
  serverExternalPackages: ['pg', 'pino'],
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: 'https', hostname: mediaHost() }] },
  env: { NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN ?? '' },
}

export default config
