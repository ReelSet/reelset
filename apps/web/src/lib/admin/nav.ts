import type { Attention } from '@/server/admin/stats'

export const ADMIN_ROUTES = {
  overview: '/admin',
  users: '/admin/users',
  spend: '/admin/spend',
  ask: '/admin/ask',
  pipeline: '/admin/pipeline',
  items: '/admin/items',
  gate: '/admin/gate',
  renders: '/admin/renders',
  ingest: '/admin/ingest',
  generate: '/admin/generate',
  instagram: '/admin/instagram',
  instagramInsights: '/admin/instagram/insights',
  settings: '/admin/settings',
  director: '/admin/director',
  gateSettings: '/admin/gate-settings',
} as const

export type AdminIcon = 'overview' | 'pipeline' | 'generate' | 'instagram' | 'settings'
export type AdminTab = { href: string; label: string }
export type NavBadge = 'pipeline' | 'generate' | 'instagram'

export type NavSection = 'Monitor' | 'Publish' | 'Configure'

export type NavGroup = {
  key: string
  section: NavSection
  label: string
  icon: AdminIcon
  href: string
  tabs: readonly AdminTab[]
  badge?: NavBadge
}

export const OVERVIEW_TABS: readonly AdminTab[] = [
  { href: ADMIN_ROUTES.overview, label: 'Dashboard' },
  { href: ADMIN_ROUTES.users, label: 'Users' },
  { href: ADMIN_ROUTES.spend, label: 'Spend' },
  { href: ADMIN_ROUTES.ask, label: 'Ask log' },
]

export const PIPELINE_TABS: readonly AdminTab[] = [
  { href: ADMIN_ROUTES.pipeline, label: 'Live' },
  { href: ADMIN_ROUTES.items, label: 'Items' },
  { href: ADMIN_ROUTES.gate, label: 'Gate' },
  { href: ADMIN_ROUTES.renders, label: 'Renders' },
  { href: ADMIN_ROUTES.ingest, label: 'Sources' },
]

export const INSTAGRAM_TABS: readonly AdminTab[] = [
  { href: ADMIN_ROUTES.instagram, label: 'Queue' },
  { href: ADMIN_ROUTES.instagramInsights, label: 'Insights' },
]

export const SETTINGS_TABS: readonly AdminTab[] = [
  { href: ADMIN_ROUTES.settings, label: 'General' },
  { href: ADMIN_ROUTES.director, label: 'Director' },
  { href: ADMIN_ROUTES.gateSettings, label: 'Gate' },
]

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'overview',
    section: 'Monitor',
    label: 'Overview',
    icon: 'overview',
    href: ADMIN_ROUTES.overview,
    tabs: OVERVIEW_TABS,
  },
  {
    key: 'pipeline',
    section: 'Monitor',
    label: 'Pipeline',
    icon: 'pipeline',
    href: ADMIN_ROUTES.pipeline,
    tabs: PIPELINE_TABS,
    badge: 'pipeline',
  },
  {
    key: 'generate',
    section: 'Publish',
    label: 'Generate',
    icon: 'generate',
    href: ADMIN_ROUTES.generate,
    tabs: [{ href: ADMIN_ROUTES.generate, label: 'Generate' }],
    badge: 'generate',
  },
  {
    key: 'instagram',
    section: 'Publish',
    label: 'Instagram',
    icon: 'instagram',
    href: ADMIN_ROUTES.instagram,
    tabs: INSTAGRAM_TABS,
    badge: 'instagram',
  },
  {
    key: 'settings',
    section: 'Configure',
    label: 'Settings',
    icon: 'settings',
    href: ADMIN_ROUTES.settings,
    tabs: SETTINGS_TABS,
  },
]

export type NavBadges = Partial<Record<NavBadge, number>>

export function navBadges(attention: Attention): NavBadges {
  return {
    pipeline: attention.failedItems,
    generate:
      attention.openUpgradeRequests + attention.openReelRequests + attention.pendingFeedSubmissions,
    instagram: attention.failedInstagramPosts,
  }
}

// The admin host serves these pages without the /admin prefix, so both spellings compare equal.
function stripAdminPrefix(path: string): string {
  return path.replace(/^\/admin(?=\/|$)/, '') || '/'
}

export function isActivePath(pathname: string, href: string): boolean {
  const current = stripAdminPrefix(pathname)
  const target = stripAdminPrefix(href)
  if (target === '/') return current === '/'
  return current === target || current.startsWith(`${target}/`)
}

/** The one tab owning the path: the longest matching href, so a nested tab does not light its parent. */
export function activeTabHref(pathname: string, tabs: readonly AdminTab[]): string | null {
  const matches = tabs.filter((t) => isActivePath(pathname, t.href))
  matches.sort((a, b) => b.href.length - a.href.length)
  return matches[0]?.href ?? null
}

export function isGroupActive(pathname: string, group: NavGroup): boolean {
  return group.tabs.some((tab) => isActivePath(pathname, tab.href))
}
