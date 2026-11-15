import { describe, expect, it } from 'vitest'
import { ADMIN_ROUTES, NAV_GROUPS, isActivePath, isGroupActive, navBadges } from './nav'

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
      }),
    ).toEqual({ pipeline: 2, instagram: 1, generate: 12 })
  })
})
