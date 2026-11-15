import type { Attention } from '@/server/admin/stats'

export const ADMIN_ROUTES = {
  overview: '/admin',
  spend: '/admin/spend',
  ask: '/admin/ask',
  pipeline: '/admin/pipeline',
  items: '/admin/items',
  renders: '/admin/renders',
  ingest: '/admin/ingest',
  generate: '/admin/generate',
  instagram: '/admin/instagram',
  settings: '/admin/settings',
  director: '/admin/director',
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
  { href: ADMIN_ROUTES.spend, label: 'Spend' },
  { href: ADMIN_ROUTES.ask, label: 'Ask log' },
]

export const PIPELINE_TABS: readonly AdminTab[] = [
  { href: ADMIN_ROUTES.pipeline, label: 'Live' },
  { href: ADMIN_ROUTES.items, label: 'Items' },
  { href: ADMIN_ROUTES.renders, label: 'Renders' },
  { href: ADMIN_ROUTES.ingest, label: 'Sources' },
]

export const SETTINGS_TABS: readonly AdminTab[] = [
  { href: ADMIN_ROUTES.settings, label: 'General' },
  { href: ADMIN_ROUTES.director, label: 'Director' },
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
    tabs: [{ href: ADMIN_ROUTES.instagram, label: 'Instagram' }],
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
    generate: attention.openUpgradeRequests + attention.openReelRequests,
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

export function isGroupActive(pathname: string, group: NavGroup): boolean {
  return group.tabs.some((tab) => isActivePath(pathname, tab.href))
}
