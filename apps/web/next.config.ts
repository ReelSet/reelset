import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@reelset/core'],
  serverExternalPackages: ['pg', 'pino'],
  poweredByHeader: false,
}

export default config
