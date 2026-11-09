import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@reelset/core'],
  serverExternalPackages: ['pg', 'pino'],
  poweredByHeader: false,
  env: { NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN ?? '' },
}

export default config
