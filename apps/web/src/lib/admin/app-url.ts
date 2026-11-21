import { SITE_URL } from '@/lib/seo/site'

/**
 * Links from admin pages to the public app. On admin.reelset.app a relative path is rewritten
 * under /admin, so production links must name the main domain; local dev serves both on one host.
 */
export function appHref(path: string, env: string | undefined = process.env.NODE_ENV): string {
  return env === 'production' ? new URL(path, SITE_URL).toString() : path
}
