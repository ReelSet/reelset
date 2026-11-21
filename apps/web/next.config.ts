import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@reelset/core'],
  serverExternalPackages: ['pg', 'pino'],
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  // Posters on R2 are already sized; /_next/image on Workers would bill a call plus transforms.
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN ?? '' },
}

export default config
