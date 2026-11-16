import { vi } from 'vitest'
import type { IgAccount, PostForStats } from '@reelset/core'
import type { OfficialClient } from './official-client'
import type { IgStore } from './store'

export const OFFICIAL_ME = { userId: '17841400000000001', username: 'reelset_app' }

export function fakeOfficialClient(overrides: Partial<OfficialClient> = {}): OfficialClient {
  return {
    canManageTokens: false,
    listAccounts: vi.fn(async () => [OFFICIAL_ME]),
    getClientBusinessId: vi.fn(async () => 'biz1'),
    deleteMedia: vi.fn(async () => true),
    listMediaStats: vi.fn(async () => ({ media: [], next: null })),
    getMediaInsights: vi.fn(async () => ({ views: 100, reach: 80, saves: 3, shares: 2 })),
    inspectToken: vi.fn(async () => ({
      valid: true,
      expiresAt: null,
      scopes: ['instagram_basic', 'instagram_content_publish', 'business_management'],
    })),
    createReelContainer: vi.fn(async () => 'c1'),
    getContainerStatus: vi.fn(async () => ({ statusCode: 'FINISHED' as const, status: null })),
    publish: vi.fn(async () => 'm1'),
    getPublishingLimit: vi.fn(async () => ({ used: 1, total: 100 })),
    getPermalink: vi.fn(async () => 'https://www.instagram.com/reel/ABC/'),
    listMediaSince: vi.fn(async () => []),
    refreshToken: vi.fn(async () => 'fresh-token'),
    ...overrides,
  }
}

type OfficialStore = Pick<
  IgStore,
  | 'getOfficialToken'
  | 'saveOfficialToken'
  | 'clearOfficialToken'
  | 'getOfficialAccount'
  | 'setOfficialAccount'
  | 'getContainerId'
  | 'setContainerId'
  | 'getStatsSyncedAt'
  | 'setStatsSyncedAt'
  | 'listPostsForStats'
  | 'setPostStats'
  | 'setPostInsights'
>

export function officialStoreStubs(
  initial: {
    token?: string | null
    account?: IgAccount | null
    containers?: Record<string, string>
    statsSyncedAt?: Date | null
    posts?: PostForStats[]
  } = {},
) {
  let token = initial.token ?? null
  let account = initial.account ?? null
  const containers = new Map(Object.entries(initial.containers ?? {}))
  let statsSyncedAt = initial.statsSyncedAt ?? null
  const store: OfficialStore = {
    getOfficialToken: async () => token,
    saveOfficialToken: vi.fn(async (blob: string) => {
      token = blob
    }),
    clearOfficialToken: vi.fn(async () => {
      token = null
    }),
    getOfficialAccount: async () => account,
    setOfficialAccount: vi.fn(async (next: IgAccount) => {
      account = next
    }),
    getContainerId: async (postId) => containers.get(postId) ?? null,
    setContainerId: vi.fn(async (postId: string, containerId: string | null) => {
      if (containerId) containers.set(postId, containerId)
      else containers.delete(postId)
    }),
    getStatsSyncedAt: async () => statsSyncedAt,
    setStatsSyncedAt: vi.fn(async (at: Date) => {
      statsSyncedAt = at
    }),
    listPostsForStats: vi.fn(async () => initial.posts ?? []),
    setPostStats: vi.fn(async () => {}),
    setPostInsights: vi.fn(async () => {}),
  }
  return { store, token: () => token, account: () => account, containers }
}
