import { describe, expect, it, vi } from 'vitest'
import type { IgAccount, PostForStats } from '@reelset/core'
import { silentLog } from '../testing'
import type { IgContainerClient } from './container-client'
import { encryptJson, importSessionKey } from './crypto'
import { OfficialApiError, type MediaStats, type OfficialClient } from './official-client'
import type { StoredToken } from './official-service'
import { OFFICIAL_ME, fakeOfficialClient, officialStoreStubs } from './official-testing'
import type { IgDeps } from './service'
import { INSIGHTS_PER_RUN, STATS_MAX_PAGES, matchMedia, syncInstagramStats } from './stats-sync'
import type { IgStore } from './store'

const KEY = await importSessionKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(7))))
const NOW = new Date('2026-11-16T12:00:00Z')
const DAY = 86_400_000
const RAW_TOKEN = 'EAAGtesttokenvalue1234567890'
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const TOKEN: StoredToken = {
  accessToken: RAW_TOKEN,
  userId: OFFICIAL_ME.userId,
  username: OFFICIAL_ME.username,
  clientBusinessId: 'biz1',
  savedAt: ago(DAY).toISOString(),
  refreshedAt: null,
  expiresAt: null,
  expiryKnown: false,
  scopes: null,
  checkedAt: null,
  refreshAttemptAt: null,
  expiryAlertAt: null,
}
const account: IgAccount = {
  username: OFFICIAL_ME.username,
  state: 'connected',
  message: null,
  checkedAt: NOW.toISOString(),
  loginFailures: 0,
  publisher: 'official',
}

const OFFICIAL_POST: PostForStats = {
  id: 'p-official',
  media_pk: '18348533563262111',
  permalink: 'https://www.instagram.com/reel/DfzR6tcCO8s/',
  official: true,
  posted_at: ago(2 * DAY),
  insights_at: null,
}
const UNOFFICIAL_POST: PostForStats = {
  id: 'p-unofficial',
  media_pk: '4027620817528986350',
  permalink: 'https://www.instagram.com/p/DfyKbvwvcqo/',
  official: false,
  posted_at: ago(5 * DAY),
  insights_at: null,
}
const media = (id: string, shortcode: string, likes: number | null, comments = 1): MediaStats => ({
  id,
  shortcode,
  permalink: `https://www.instagram.com/reel/${shortcode}/`,
  likes,
  comments,
})
const LIST = [
  media('18348533563262111', 'DfzR6tcCO8s', 40, 4),
  media('17900000000000001', 'DfyKbvwvcqo', 900, 30),
  media('17900000000000002', 'SomeoneElse', 5),
]
const apiError = (kind: OfficialApiError['kind']) =>
  new OfficialApiError(kind, `meta ${kind}`, true)

async function setup(
  opts: {
    token?: StoredToken | null
    account?: IgAccount | null
    posts?: PostForStats[]
    syncedAt?: Date | null
    official?: Partial<OfficialClient>
  } = {},
) {
  const token = opts.token === undefined ? TOKEN : opts.token
  const stubs = officialStoreStubs({
    token: token ? await encryptJson(KEY, token) : null,
    account: opts.account === undefined ? account : opts.account,
    statsSyncedAt: opts.syncedAt,
    posts: opts.posts ?? [OFFICIAL_POST, UNOFFICIAL_POST],
  })
  const client = fakeOfficialClient({
    listMediaStats: vi.fn(async () => ({ media: LIST, next: null })),
    ...opts.official,
  })
  const deps = {
    store: stubs.store as unknown as IgStore,
    client: {} as IgContainerClient,
    key: KEY,
    envCreds: null,
    mediaBaseUrl: 'https://media.reelset.app',
    log: silentLog,
    now: () => NOW,
    official: client,
    preferredUsername: null,
    publisher: async () => 'unofficial' as const,
    aiLabel: async () => false,
    alert: vi.fn(async () => 'sent'),
  } satisfies IgDeps
  return { deps, store: stubs.store, client, stubs }
}

describe('matchMedia', () => {
  const byId = new Map(LIST.map((m) => [m.id, m]))
  const byShortcode = new Map(LIST.map((m) => [m.shortcode!, m]))

  it('matches an official post by its media id', () => {
    expect(matchMedia(OFFICIAL_POST, byId, byShortcode)?.likes).toBe(40)
  })

  it('matches an unofficial post by the shortcode in its permalink', () => {
    expect(matchMedia(UNOFFICIAL_POST, byId, byShortcode)?.id).toBe('17900000000000001')
  })

  it('finds nothing for a post with neither a known id nor a shortcode', () => {
    const lost = { ...UNOFFICIAL_POST, permalink: 'https://www.instagram.com/reelset_app/reels/' }
    expect(matchMedia(lost, byId, byShortcode)).toBeNull()
  })
})

describe('syncInstagramStats', () => {
  it('runs at most once an hour', async () => {
    const t = await setup({ syncedAt: ago(59 * 60_000) })
    expect(await syncInstagramStats(t.deps)).toEqual({ ran: false, reason: 'not_due' })
    expect(t.client.listMediaStats).not.toHaveBeenCalled()
  })

  it('needs a saved token that Meta has not rejected', async () => {
    const none = await setup({ token: null })
    expect(await syncInstagramStats(none.deps)).toEqual({ ran: false, reason: 'no_token' })
    const rejected = await setup({ account: { ...account, state: 'needs_login' } })
    expect(await syncInstagramStats(rejected.deps)).toEqual({
      ran: false,
      reason: 'not_connected',
    })
    expect(rejected.client.listMediaStats).not.toHaveBeenCalled()
  })

  it('writes likes and comments for posts of both publishers, whichever is selected', async () => {
    const t = await setup()
    const outcome = await syncInstagramStats(t.deps)
    expect(outcome).toMatchObject({ ran: true, posts: 2, matched: 2 })
    expect(t.store.setPostStats).toHaveBeenCalledWith('p-official', { likes: 40, comments: 4 })
    expect(t.store.setPostStats).toHaveBeenCalledWith('p-unofficial', { likes: 900, comments: 30 })
    expect(t.store.setStatsSyncedAt).toHaveBeenCalledWith(NOW)
  })

  it('reads insights with the graph media id, not the stored instagrapi pk', async () => {
    const t = await setup()
    expect(await syncInstagramStats(t.deps)).toMatchObject({
      insights: 2,
      insightsPermission: true,
    })
    expect(t.client.getMediaInsights).toHaveBeenCalledWith(RAW_TOKEN, '17900000000000001')
    expect(t.store.setPostInsights).toHaveBeenCalledWith('p-unofficial', {
      views: 100,
      reach: 80,
      saves: 3,
      shares: 2,
    })
    expect(t.stubs.account()?.insightsPermission).toBe(true)
  })

  it('skips insights quietly and records it when the token scopes lack the permission', async () => {
    const t = await setup({ token: { ...TOKEN, scopes: ['instagram_basic'] } })
    expect(await syncInstagramStats(t.deps)).toMatchObject({
      matched: 2,
      insights: 0,
      insightsPermission: false,
    })
    expect(t.client.getMediaInsights).not.toHaveBeenCalled()
    expect(t.stubs.account()?.insightsPermission).toBe(false)
    expect(t.deps.alert).not.toHaveBeenCalled()
  })

  it('stops at the first permission refusal when the scopes are unknown', async () => {
    const t = await setup({
      official: { getMediaInsights: vi.fn(async () => Promise.reject(apiError('permission'))) },
    })
    expect(await syncInstagramStats(t.deps)).toMatchObject({
      matched: 2,
      insights: 0,
      insightsPermission: false,
    })
    expect(t.client.getMediaInsights).toHaveBeenCalledTimes(1)
    expect(t.store.setPostStats).toHaveBeenCalledTimes(2)
    expect(t.stubs.account()?.insightsPermission).toBe(false)
  })

  it('only asks insights for the last 30 days, oldest-refreshed first, capped per run', async () => {
    const posts: PostForStats[] = Array.from({ length: INSIGHTS_PER_RUN + 5 }, (_, i) => ({
      id: `p${i}`,
      media_pk: `m${i}`,
      permalink: null,
      official: true,
      posted_at: ago(DAY),
      insights_at: ago((i + 1) * 60_000),
    }))
    posts.push({ ...posts[0]!, id: 'old', media_pk: 'm-old', posted_at: ago(31 * DAY) })
    posts.push({ ...posts[0]!, id: 'never', media_pk: 'm-never', insights_at: null })
    const list = posts.map((p) => media(p.media_pk!, `s-${p.id}`, 1))
    const t = await setup({
      posts,
      official: { listMediaStats: vi.fn(async () => ({ media: list, next: null })) },
    })
    expect(await syncInstagramStats(t.deps)).toMatchObject({ insights: INSIGHTS_PER_RUN })
    const asked = vi.mocked(t.client.getMediaInsights).mock.calls.map(([, id]) => id)
    expect(asked[0]).toBe('m-never')
    expect(asked[1]).toBe(`m${INSIGHTS_PER_RUN + 4}`)
    expect(asked).not.toContain('m-old')
    expect(asked).not.toContain('m0')
  })

  it('moves on when one media has no insights and gives up after repeated failures', async () => {
    const t = await setup({
      official: { getMediaInsights: vi.fn(async () => Promise.reject(apiError('rejected'))) },
    })
    expect(await syncInstagramStats(t.deps)).toMatchObject({
      insights: 0,
      insightsPermission: null,
    })
    expect(t.store.setPostInsights).toHaveBeenCalledWith('p-official', null)
    expect(t.stubs.account()?.insightsPermission).toBeUndefined()
    const limited = await setup({
      official: { getMediaInsights: vi.fn(async () => Promise.reject(apiError('rate_limited'))) },
    })
    await syncInstagramStats(limited.deps)
    expect(limited.client.getMediaInsights).toHaveBeenCalledTimes(1)
  })

  it('pages through the media list up to the cap', async () => {
    const t = await setup({
      official: {
        listMediaStats: vi.fn(async (_token: string, _id: string, after: string | null) => ({
          media: after === null ? [LIST[0]!] : [LIST[1]!],
          next: `c${Number((after ?? 'c0').slice(1)) + 1}`,
        })),
      },
    })
    expect(await syncInstagramStats(t.deps)).toMatchObject({ matched: 2 })
    expect(t.client.listMediaStats).toHaveBeenCalledTimes(STATS_MAX_PAGES)
    expect(vi.mocked(t.client.listMediaStats).mock.calls[1]?.[2]).toBe('c1')
  })

  it('does not call Instagram when there are no posts, and waits an hour after a failure', async () => {
    const empty = await setup({ posts: [] })
    expect(await syncInstagramStats(empty.deps)).toMatchObject({ ran: true, posts: 0 })
    expect(empty.client.listMediaStats).not.toHaveBeenCalled()
    const down = await setup({
      official: {
        listMediaStats: vi.fn(async () =>
          Promise.reject(new OfficialApiError('network', 'x', false)),
        ),
      },
    })
    await expect(syncInstagramStats(down.deps)).rejects.toThrow()
    expect(await syncInstagramStats(down.deps)).toEqual({ ran: false, reason: 'not_due' })
  })
})
