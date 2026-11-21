import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/site'

const PRIVATE_PATHS = ['/admin', '/api/', '/auth/', '/login', '/profile']

// Filtered variants repeat canonical pages (they carry noindex and a canonical tag); keeping
// crawlers out of the combinatorial ?topic= / ?source= space, and the internal /by/ paths the
// proxy rewrites them to, stops them re-walking every reel and topic under each filter.
const VARIANT_PATHS = ['/*?*topic=', '/*?*source=', '/t/by/', '/t/*/by/']

const DISALLOW = [...PRIVATE_PATHS, ...VARIANT_PATHS]

// AI crawlers are welcome: being read and cited by answer engines is the point (GEO).
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Meta-ExternalAgent',
  'Amazonbot',
  'DuckAssistBot',
  'cohere-ai',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
