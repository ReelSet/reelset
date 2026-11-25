import { SITE_URL } from '@/lib/seo/site'

// ai-train is yes because the training crawlers (GPTBot, CCBot, Google-Extended) are already allowed.
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes'

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

function group(userAgents: string[]): string {
  return [
    ...userAgents.map((ua) => `User-Agent: ${ua}`),
    `Content-Signal: ${CONTENT_SIGNAL}`,
    'Allow: /',
    ...DISALLOW.map((p) => `Disallow: ${p}`),
  ].join('\n')
}

export function buildRobotsTxt(): string {
  return `${[group(['*']), group(AI_CRAWLERS), `Host: ${SITE_URL}\nSitemap: ${SITE_URL}/sitemap.xml`].join('\n\n')}\n`
}
