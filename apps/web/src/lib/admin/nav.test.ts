import { describe, expect, it } from 'vitest'
import {
  ADMIN_ROUTES,
  NAV_GROUPS,
  PIPELINE_TABS,
  SETTINGS_TABS,
  activeTabHref,
  isActivePath,
  isGroupActive,
  navBadges,
} from './nav'
import { safeAdminPath } from './retry'

const group = (key: string) => NAV_GROUPS.find((g) => g.key === key)!

describe('isActivePath', () => {
  it('matches the index only exactly', () => {
    expect(isActivePath('/admin', ADMIN_ROUTES.overview)).toBe(true)
    expect(isActivePath('/admin/spend', ADMIN_ROUTES.overview)).toBe(false)
  })

  it('matches nested paths by segment', () => {
    expect(isActivePath('/admin/director/edit', ADMIN_ROUTES.director)).toBe(true)
    expect(isActivePath('/admin/directors', ADMIN_ROUTES.director)).toBe(false)
  })

  it('treats the admin-host spelling without the prefix the same', () => {
    expect(isActivePath('/', ADMIN_ROUTES.overview)).toBe(true)
    expect(isActivePath('/spend', ADMIN_ROUTES.spend)).toBe(true)
    expect(isActivePath('/spend', ADMIN_ROUTES.overview)).toBe(false)
  })
})

describe('isGroupActive', () => {
  it('marks the group owning the current tab', () => {
    expect(isGroupActive('/admin/renders', group('pipeline'))).toBe(true)
    expect(isGroupActive('/admin/renders', group('overview'))).toBe(false)
    expect(isGroupActive('/admin', group('overview'))).toBe(true)
    expect(isGroupActive('/admin/director', group('settings'))).toBe(true)
  })
})

describe('navBadges', () => {
  it('sums generate queues and maps the rest', () => {
    expect(
      navBadges({
        failedItems: 2,
        failedInstagramPosts: 1,
        openUpgradeRequests: 3,
        openReelRequests: 4,
        pendingFeedSubmissions: 5,
        gateAwaitingReview: 40,
      }),
    ).toEqual({ pipeline: 2, instagram: 1, generate: 12 })
  })
})

describe('gate routes', () => {
  it('lists the review queue under Pipeline and its settings under Settings', () => {
    expect(PIPELINE_TABS).toContainEqual({ href: ADMIN_ROUTES.gate, label: 'Gate' })
    expect(SETTINGS_TABS).toContainEqual({ href: ADMIN_ROUTES.gateSettings, label: 'Gate' })
  })

  it('never lights up both groups for one page', () => {
    expect(isGroupActive(ADMIN_ROUTES.gate, group('pipeline'))).toBe(true)
    expect(isGroupActive(ADMIN_ROUTES.gate, group('settings'))).toBe(false)
    expect(isGroupActive(ADMIN_ROUTES.gateSettings, group('settings'))).toBe(true)
    expect(isGroupActive(ADMIN_ROUTES.gateSettings, group('pipeline'))).toBe(false)
    expect(isActivePath(ADMIN_ROUTES.gateSettings, ADMIN_ROUTES.gate)).toBe(false)
  })

  it('are accepted as redirect targets for their forms', () => {
    const queue = `${ADMIN_ROUTES.gate}?review=all&by=explore&page=2`
    expect(safeAdminPath(queue)).toBe(queue)
    const starred = ADMIN_ROUTES.gate + '?q=c*+%3Cb%3E%27x'
    expect(safeAdminPath(starred)).toBe(starred)
    expect(safeAdminPath(`${ADMIN_ROUTES.gate}?q=<script>`)).toBe(ADMIN_ROUTES.pipeline)
    expect(safeAdminPath(ADMIN_ROUTES.gateSettings)).toBe(ADMIN_ROUTES.gateSettings)
  })
})

describe('activeTabHref', () => {
  it('lights only the nested Insights tab, not its parent Queue tab', () => {
    const tabs = group('instagram').tabs
    expect(activeTabHref(ADMIN_ROUTES.instagramInsights, tabs)).toBe(ADMIN_ROUTES.instagramInsights)
    expect(activeTabHref(ADMIN_ROUTES.instagram, tabs)).toBe(ADMIN_ROUTES.instagram)
    expect(activeTabHref('/admin/spend', tabs)).toBeNull()
  })
})
