import { describe, expect, it, vi } from 'vitest'
import {
  INSTAGRAM_LOST_ERROR,
  type AlertInput,
  type IgAccount,
  type InstagramPublisher,
} from '@reelset/core'
import { silentLog } from '../testing'
import type { IgContainerClient } from './container-client'
import { encryptJson, importSessionKey } from './crypto'
import { OfficialApiError, type OfficialClient } from './official-client'
import {
  CONTAINER_POLL_BUDGET_MS,
  MAX_TRANSIENT_ATTEMPTS,
  UNOFFICIAL_DELETE_MESSAGE,
  checkOfficialAccount,
  connectOfficialAccount,
  disconnectOfficialAccount,
  loadOfficialToken,
  refreshOfficialToken,
  type StoredToken,
} from './official-service'
import { OFFICIAL_ME, fakeOfficialClient, officialStoreStubs } from './official-testing'
import { connectActiveAccount, runInstagramQueue, type IgDeps } from './service'
import type { ClaimedPost, IgStore, LostPost } from './store'

const KEY = await importSessionKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(5))))
const NOW = new Date('2026-11-16T12:00:00Z')
const DAY = 86_400_000
const RAW_TOKEN = 'IGAAtesttokenvalue1234567890'
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

const SCOPES = ['instagram_basic', 'instagram_content_publish', 'business_management']
const inspected = (expiresAt: Date | null, scopes = SCOPES) =>
  vi.fn(async () => ({ valid: true, expiresAt, scopes }))

const TOKEN: StoredToken = {
  accessToken: RAW_TOKEN,
  userId: OFFICIAL_ME.userId,
  username: OFFICIAL_ME.username,
  clientBusinessId: 'biz1',
  savedAt: ago(2 * DAY),
  refreshedAt: null,
  expiresAt: null,
  expiryKnown: true,
  scopes: SCOPES,
  checkedAt: ago(2 * DAY),
  refreshAttemptAt: null,
  expiryAlertAt: null,
}
const POST: ClaimedPost = {
  id: 'p1',
  item_id: 'i1',
  video_key: 'reels/i1/k.mp4',
  caption: 'cap @reelset_app #dev',
  media_pk: null,
  attempts: 1,
}
const LOST: LostPost = {
  id: 'p0',
  item_id: 'i0',
  caption: 'lost cap',
  started_at: new Date('2026-11-16T11:30:00Z'),
}
const connected: IgAccount = {
  username: OFFICIAL_ME.username,
  state: 'connected',
  message: null,
  checkedAt: ago(1000),
  loginFailures: 0,
  publisher: 'official',
  tokenExpiresAt: TOKEN.expiresAt,
}

const apiError = (kind: OfficialApiError['kind'], answered = true, message = `meta ${kind}`) =>
  new OfficialApiError(kind, message, answered)

async function setup(
  opts: {
    token?: StoredToken | null
    account?: IgAccount | null
    post?: ClaimedPost | null
    del?: ClaimedPost | null
    lost?: LostPost | null
    containers?: Record<string, string>
    official?: Partial<OfficialClient>
    publisher?: InstagramPublisher
    aiLabel?: boolean
    preferredUsername?: string
  } = {},
) {
  let now = NOW.getTime()
  const token = opts.token === undefined ? TOKEN : opts.token
  const official = officialStoreStubs({
    token: token ? await encryptJson(KEY, token) : null,
    account: opts.account === undefined ? connected : opts.account,
    containers: opts.containers,
  })
  const store: IgStore = {
    getSession: async () => null,
    saveSession: vi.fn(async () => {}),
    getCredentials: async () => null,
    saveCredentials: vi.fn(async () => {}),
    clearConnection: vi.fn(async () => {}),
    getAccount: async () => null,
    setAccount: vi.fn(async () => {}),
    claimPost: vi.fn(async () => (opts.post === undefined ? POST : opts.post)),
    claimDelete: vi.fn(async () => opts.del ?? null),
    markPosted: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    release: vi.fn(async () => true),
    markDeleted: vi.fn(async () => true),
    restoreAfterDeleteFailure: vi.fn(async () => true),
    failStuck: vi.fn(async () => 0),
    nextLost: vi.fn(async () => opts.lost ?? null),
    recentMediaPks: vi.fn(async () => ['taken']),
    markLostFound: vi.fn(async () => true),
    markLostNotFound: vi.fn(async () => true),
    ...official.store,
  }
  const box = {
    supportsJobs: vi.fn(),
    status: vi.fn(),
    login: vi.fn(),
    post: vi.fn(),
    remove: vi.fn(),
    find: vi.fn(),
  }
  const client = fakeOfficialClient(opts.official)
  const alert = vi.fn(async (_input: AlertInput) => 'sent')
  const deps: IgDeps = {
    store,
    client: box as unknown as IgContainerClient,
    key: KEY,
    envCreds: null,
    mediaBaseUrl: 'https://media.reelset.app/',
    log: silentLog,
    now: () => new Date(now),
    sleep: vi.fn(async (ms: number) => {
      now += ms
    }),
    official: client,
    preferredUsername: opts.preferredUsername ?? null,
    publisher: async () => opts.publisher ?? 'official',
    aiLabel: async () => opts.aiLabel ?? false,
    alert,
  }
  return {
    deps,
    store,
    client,
    box,
    alert,
    official,
    savedToken: () => loadOfficialToken(deps),
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('connectOfficialAccount', () => {
  const other = { userId: '222', username: 'someone_else' }

  it('finds the assigned account and saves the token encrypted with the business id', async () => {
    const t = await setup({ token: null, account: null })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(t.client.listAccounts).toHaveBeenCalledWith(RAW_TOKEN)
    expect(account).toMatchObject({
      state: 'connected',
      username: 'reelset_app',
      publisher: 'official',
      tokenExpiresAt: null,
    })
    expect(account.message).toMatch(/META_APP_ID/)
    expect(t.official.token()).not.toContain(RAW_TOKEN)
    expect(await t.savedToken()).toMatchObject({
      accessToken: RAW_TOKEN,
      userId: OFFICIAL_ME.userId,
      clientBusinessId: 'biz1',
      expiryKnown: false,
      expiresAt: null,
    })
    expect(t.client.inspectToken).not.toHaveBeenCalled()
  })

  it('reads the expiry at connect when the Meta app secrets are set', async () => {
    const expires = new Date(NOW.getTime() + 40 * DAY)
    const t = await setup({
      token: null,
      account: null,
      official: { canManageTokens: true, inspectToken: inspected(expires) },
    })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(account).toMatchObject({ tokenExpiresAt: expires.toISOString(), message: null })
    expect(await t.savedToken()).toMatchObject({ expiryKnown: true, scopes: SCOPES })
  })

  it('says so when the token never expires', async () => {
    const t = await setup({
      token: null,
      account: null,
      official: { canManageTokens: true },
    })
    expect((await connectOfficialAccount(t.deps, RAW_TOKEN)).message).toBe(
      'This token does not expire.',
    )
  })

  it('refuses a token without the publish permission', async () => {
    const t = await setup({
      token: null,
      account: null,
      official: { canManageTokens: true, inspectToken: inspected(null, ['instagram_basic']) },
    })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(account.state).toBe('needs_login')
    expect(account.message).toMatch(/instagram_content_publish/)
    expect(t.store.saveOfficialToken).not.toHaveBeenCalled()
  })

  it('still saves the token when the business id cannot be read', async () => {
    const t = await setup({
      token: null,
      account: null,
      official: { getClientBusinessId: vi.fn(async () => Promise.reject(apiError('transient'))) },
    })
    expect((await connectOfficialAccount(t.deps, RAW_TOKEN)).state).toBe('connected')
    expect((await t.savedToken())?.clientBusinessId).toBeNull()
  })

  it('picks the IG_USERNAME account when the token covers several', async () => {
    const t = await setup({
      token: null,
      account: null,
      preferredUsername: '@Reelset_App',
      official: { listAccounts: vi.fn(async () => [other, OFFICIAL_ME]) },
    })
    expect((await connectOfficialAccount(t.deps, RAW_TOKEN)).username).toBe('reelset_app')
    expect((await t.savedToken())?.userId).toBe(OFFICIAL_ME.userId)
  })

  it('lists the usernames when it cannot tell which of several accounts to use', async () => {
    const accounts = { listAccounts: vi.fn(async () => [other, OFFICIAL_ME]) }
    const unset = await setup({ token: null, account: null, official: accounts })
    const a = await connectOfficialAccount(unset.deps, RAW_TOKEN)
    expect(a.state).toBe('needs_login')
    expect(a.message).toMatch(/@someone_else, @reelset_app/)
    expect(a.message).toMatch(/IG_USERNAME/)
    expect(unset.store.saveOfficialToken).not.toHaveBeenCalled()
    const wrong = await setup({
      token: null,
      account: null,
      official: accounts,
      preferredUsername: 'third',
    })
    expect((await connectOfficialAccount(wrong.deps, RAW_TOKEN)).message).toMatch(/not @third/)
  })

  it('explains a token with no Instagram account assigned', async () => {
    const t = await setup({
      token: null,
      account: null,
      official: { listAccounts: vi.fn(async () => []) },
    })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(account.state).toBe('needs_login')
    expect(account.message).toMatch(/no Instagram account assigned/)
  })

  it('does not save a token Meta rejects', async () => {
    const t = await setup({
      token: null,
      account: null,
      official: { listAccounts: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(account.state).toBe('needs_login')
    expect(account.message).toMatch(/rejected the access token/)
    expect(t.store.saveOfficialToken).not.toHaveBeenCalled()
    expect(t.official.account()?.state).toBe('needs_login')
  })

  it('keeps a working token and its record when a replacement is rejected', async () => {
    const t = await setup({
      official: { listAccounts: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    const account = await connectOfficialAccount(t.deps, 'EAAGanotherbadtoken000000000')
    expect(account.state).toBe('needs_login')
    expect(t.official.account()?.state).toBe('connected')
    expect((await t.savedToken())?.accessToken).toBe(RAW_TOKEN)
  })

  it('takes an access token even while the unofficial publisher is active', async () => {
    const t = await setup({ token: null, account: null, publisher: 'unofficial' })
    const account = await connectActiveAccount(t.deps, { accessToken: RAW_TOKEN })
    expect(account.publisher).toBe('official')
    expect(t.box.login).not.toHaveBeenCalled()
  })
})

describe('checkOfficialAccount and disconnect', () => {
  it('reports no token as disconnected without calling Meta', async () => {
    const t = await setup({ token: null, account: null })
    expect((await checkOfficialAccount(t.deps)).state).toBe('disconnected')
    expect(t.client.listAccounts).not.toHaveBeenCalled()
  })

  it('turns a dead token into needs_login and a restricted account into challenge', async () => {
    const expired = await setup({
      official: { listAccounts: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    expect((await checkOfficialAccount(expired.deps)).state).toBe('needs_login')
    const restricted = await setup({
      official: {
        listAccounts: vi.fn(async () => Promise.reject(apiError('account_restricted'))),
      },
    })
    expect((await checkOfficialAccount(restricted.deps)).state).toBe('challenge')
  })

  it('asks for a new token when the account is no longer shared with it', async () => {
    const t = await setup({ official: { listAccounts: vi.fn(async () => []) } })
    const account = await checkOfficialAccount(t.deps)
    expect(account.state).toBe('needs_login')
    expect(account.message).toMatch(/no longer shared/)
  })

  it('leaves the state unknown when Meta cannot be reached', async () => {
    const t = await setup({
      official: { listAccounts: vi.fn(async () => Promise.reject(apiError('network', false))) },
    })
    expect((await checkOfficialAccount(t.deps)).state).toBe('unknown')
  })

  it('forgets the token on disconnect', async () => {
    const t = await setup()
    const account = await disconnectOfficialAccount(t.deps)
    expect(account.state).toBe('disconnected')
    expect(account.tokenExpiresAt).toBeNull()
    expect(t.official.token()).toBeNull()
  })
})

describe('refreshOfficialToken', () => {
  const expiring = (days: number): StoredToken => ({ ...TOKEN, expiresAt: ahead(days * DAY) })
  const alerts = (t: Awaited<ReturnType<typeof setup>>, key: string) =>
    t.alert.mock.calls.filter(([a]) => a.key === key)

  it('does nothing without a token, and at most once a day with one', async () => {
    const none = await setup({ token: null })
    expect(await refreshOfficialToken(none.deps)).toBe('no_token')
    const fresh = await setup({ token: { ...TOKEN, checkedAt: ago(DAY - 60_000) } })
    expect(await refreshOfficialToken(fresh.deps)).toBe('not_due')
    expect(fresh.client.listAccounts).not.toHaveBeenCalled()
  })

  it('only health-checks the token when the Meta app secrets are missing', async () => {
    const t = await setup({ token: { ...TOKEN, expiryKnown: false, scopes: null } })
    expect(await refreshOfficialToken(t.deps)).toBe('checked')
    expect(t.client.listAccounts).toHaveBeenCalledOnce()
    expect(t.client.inspectToken).not.toHaveBeenCalled()
    expect(t.client.refreshToken).not.toHaveBeenCalled()
    expect(t.alert).not.toHaveBeenCalled()
    expect((await t.savedToken())?.checkedAt).toBe(NOW.toISOString())
    expect(await refreshOfficialToken(t.deps)).toBe('not_due')
  })

  it('is a no-op beyond the daily check for a token that never expires', async () => {
    const t = await setup({ official: { canManageTokens: true } })
    expect(await refreshOfficialToken(t.deps)).toBe('checked')
    expect(t.client.refreshToken).not.toHaveBeenCalled()
    expect(t.alert).not.toHaveBeenCalled()
    expect(t.official.account()?.message).toBe('This token does not expire.')
  })

  it('learns the expiry on the daily check and leaves a token with time left alone', async () => {
    const expires = new Date(NOW.getTime() + 40 * DAY)
    const t = await setup({
      token: { ...TOKEN, expiryKnown: false },
      official: { canManageTokens: true, inspectToken: inspected(expires) },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('checked')
    expect(await t.savedToken()).toMatchObject({
      expiresAt: expires.toISOString(),
      expiryKnown: true,
    })
    expect(t.official.account()?.tokenExpiresAt).toBe(expires.toISOString())
    expect(t.client.refreshToken).not.toHaveBeenCalled()
  })

  it('replaces a token within 14 days of expiry and records the new expiry', async () => {
    const next = new Date(NOW.getTime() + 60 * DAY)
    const answers = [new Date(NOW.getTime() + 10 * DAY), next]
    const t = await setup({
      token: expiring(10),
      official: {
        canManageTokens: true,
        inspectToken: vi.fn(async () => ({
          valid: true,
          expiresAt: answers.shift()!,
          scopes: SCOPES,
        })),
      },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('refreshed')
    expect(t.client.refreshToken).toHaveBeenCalledWith(RAW_TOKEN, 'biz1')
    expect(t.client.inspectToken).toHaveBeenLastCalledWith('fresh-token')
    expect(await t.savedToken()).toMatchObject({
      accessToken: 'fresh-token',
      refreshedAt: NOW.toISOString(),
      expiresAt: next.toISOString(),
    })
    expect(t.alert).not.toHaveBeenCalled()
  })

  it('keeps the old token and alerts when the replacement fails', async () => {
    const t = await setup({
      token: expiring(10),
      official: {
        canManageTokens: true,
        inspectToken: inspected(new Date(NOW.getTime() + 10 * DAY)),
        refreshToken: vi.fn(async () => Promise.reject(apiError('permission'))),
      },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('failed')
    expect(alerts(t, 'instagram_token_refresh_failed')).toHaveLength(1)
    expect(alerts(t, 'instagram_token_expiring')).toHaveLength(0)
    expect((await t.savedToken())?.accessToken).toBe(RAW_TOKEN)
    expect(t.official.account()?.state).toBe('connected')
  })

  it('warns once a day near expiry and names why it cannot refresh', async () => {
    const soon = new Date(NOW.getTime() + 5 * DAY)
    const t = await setup({
      token: expiring(5),
      official: {
        canManageTokens: true,
        inspectToken: inspected(soon, ['instagram_basic', 'instagram_content_publish']),
      },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('checked')
    expect(t.client.refreshToken).not.toHaveBeenCalled()
    const [first] = alerts(t, 'instagram_token_expiring')
    expect(first?.[0].message).toMatch(/lacks the business_management permission/)
    t.advance(5 * 60_000)
    await refreshOfficialToken(t.deps)
    expect(alerts(t, 'instagram_token_expiring')).toHaveLength(1)
    t.advance(DAY)
    await refreshOfficialToken(t.deps)
    expect(alerts(t, 'instagram_token_expiring')).toHaveLength(2)
  })

  it('does not try to refresh without a client business id', async () => {
    const t = await setup({
      token: { ...expiring(5), clientBusinessId: null },
      official: {
        canManageTokens: true,
        inspectToken: inspected(new Date(NOW.getTime() + 5 * DAY)),
      },
    })
    await refreshOfficialToken(t.deps)
    expect(t.client.refreshToken).not.toHaveBeenCalled()
    expect(alerts(t, 'instagram_token_expiring')[0]?.[0].message).toMatch(/client business id/)
  })

  it('marks the account needs_login and alerts when the token has died', async () => {
    const dead = await setup({
      official: {
        canManageTokens: true,
        inspectToken: vi.fn(async () => ({ valid: false, expiresAt: null, scopes: [] })),
      },
    })
    expect(await refreshOfficialToken(dead.deps)).toBe('failed')
    expect(dead.official.account()?.state).toBe('needs_login')
    expect(alerts(dead, 'instagram_token_refresh_failed')).toHaveLength(1)
    expect(await refreshOfficialToken(dead.deps)).toBe('not_due')

    const noSecrets = await setup({
      official: { listAccounts: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    expect(await refreshOfficialToken(noSecrets.deps)).toBe('failed')
    expect(noSecrets.official.account()?.state).toBe('needs_login')
  })

  it('tries again on the next tick when the check could not reach Meta', async () => {
    const t = await setup({
      official: { listAccounts: vi.fn(async () => Promise.reject(apiError('network', false))) },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('failed')
    expect(t.alert).not.toHaveBeenCalled()
    expect(t.official.account()?.state).toBe('connected')
    expect(await refreshOfficialToken(t.deps)).toBe('failed')
    expect(t.client.listAccounts).toHaveBeenCalledTimes(2)
  })
})

describe('runInstagramQueue with the official publisher', () => {
  it('waits without claiming when no token is saved or the token was rejected', async () => {
    const none = await setup({ token: null })
    expect(await runInstagramQueue(none.deps)).toEqual({ ran: 'none', reason: 'not_connected' })
    const rejected = await setup({ account: { ...connected, state: 'needs_login' } })
    expect(await runInstagramQueue(rejected.deps)).toEqual({ ran: 'none', reason: 'not_connected' })
    expect(rejected.store.claimPost).not.toHaveBeenCalled()
  })

  it('publishes from the public R2 urls and records the post, without the render box', async () => {
    const t = await setup()
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'post', postId: 'p1', ok: true })
    expect(t.client.createReelContainer).toHaveBeenCalledWith(RAW_TOKEN, OFFICIAL_ME.userId, {
      videoUrl: 'https://media.reelset.app/reels/i1/k.mp4',
      coverUrl: 'https://media.reelset.app/reels/i1/k.jpg',
      caption: POST.caption,
      aiGenerated: false,
    })
    expect(t.client.publish).toHaveBeenCalledWith(RAW_TOKEN, OFFICIAL_ME.userId, 'c1')
    expect(t.store.markPosted).toHaveBeenCalledWith('p1', {
      mediaPk: 'm1',
      permalink: 'https://www.instagram.com/reel/ABC/',
    })
    const saved = vi.mocked(t.store.setContainerId).mock.invocationCallOrder[0]!
    const published = vi.mocked(t.client.publish).mock.invocationCallOrder[0]!
    expect(saved).toBeLessThan(published)
    for (const call of Object.values(t.box)) expect(call).not.toHaveBeenCalled()
  })

  it('passes the AI label when the setting is on', async () => {
    const t = await setup({ aiLabel: true })
    await runInstagramQueue(t.deps)
    expect(t.client.createReelContainer).toHaveBeenCalledWith(
      RAW_TOKEN,
      OFFICIAL_ME.userId,
      expect.objectContaining({ aiGenerated: true }),
    )
  })

  it('resumes the saved container instead of uploading again', async () => {
    const t = await setup({ containers: { p1: 'c-old' } })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: true })
    expect(t.client.createReelContainer).not.toHaveBeenCalled()
    expect(t.client.getPublishingLimit).not.toHaveBeenCalled()
    expect(t.client.publish).toHaveBeenCalledWith(RAW_TOKEN, OFFICIAL_ME.userId, 'c-old')
  })

  it('waits while Instagram processes the video, then publishes', async () => {
    const statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'] as const
    let i = 0
    const t = await setup({
      official: {
        getContainerStatus: vi.fn(async () => ({ statusCode: statuses[i++]!, status: null })),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: true })
    expect(t.deps.sleep).toHaveBeenCalledTimes(2)
  })

  it('puts the post back with its container when processing outlasts 5 minutes', async () => {
    const t = await setup({
      official: {
        getContainerStatus: vi.fn(async () => ({
          statusCode: 'IN_PROGRESS' as const,
          status: null,
        })),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    const slept = vi.mocked(t.deps.sleep!).mock.calls.reduce((sum, [ms]) => sum + ms, 0)
    expect(slept).toBeLessThanOrEqual(CONTAINER_POLL_BUDGET_MS)
    expect(t.store.release).toHaveBeenCalledWith('p1', expect.stringMatching(/still processing/))
    expect(t.official.containers.get('p1')).toBe('c1')
    expect(t.client.publish).not.toHaveBeenCalled()
  })

  it('fails the post and drops the container when Instagram cannot process the video', async () => {
    const t = await setup({
      official: {
        getContainerStatus: vi.fn(async () => ({
          statusCode: 'ERROR' as const,
          status: '2207026',
        })),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    expect(t.store.markFailed).toHaveBeenCalledWith('p1', expect.stringMatching(/2207026/))
    expect(t.official.containers.has('p1')).toBe(false)
  })

  it('replaces a container that expired before it was published', async () => {
    const t = await setup({
      containers: { p1: 'c-old' },
      official: {
        getContainerStatus: vi.fn(async (_token: string, id: string) => ({
          statusCode: id === 'c-old' ? ('EXPIRED' as const) : ('FINISHED' as const),
          status: null,
        })),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: true })
    expect(t.client.publish).toHaveBeenCalledWith(RAW_TOKEN, OFFICIAL_ME.userId, 'c1')
  })

  it('records an already-published container by caption instead of publishing twice', async () => {
    const t = await setup({
      containers: { p1: 'c-old' },
      official: {
        getContainerStatus: vi.fn(async () => ({ statusCode: 'PUBLISHED' as const, status: null })),
        listMediaSince: vi.fn(async () => [
          {
            id: 'other',
            caption: 'something else',
            permalink: 'https://www.instagram.com/reel/O/',
            timestamp: new Date('2026-11-16T11:00:00Z'),
          },
          {
            id: 'm9',
            caption: 'cap reelset_app #dev',
            permalink: 'https://www.instagram.com/reel/N/',
            timestamp: new Date('2026-11-16T11:50:00Z'),
          },
        ]),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: true })
    expect(t.client.publish).not.toHaveBeenCalled()
    expect(t.store.markPosted).toHaveBeenCalledWith('p1', {
      mediaPk: 'm9',
      permalink: 'https://www.instagram.com/reel/N/',
    })
  })

  it('marks an already-published container as lost when the reel cannot be matched', async () => {
    const t = await setup({
      containers: { p1: 'c-old' },
      official: {
        getContainerStatus: vi.fn(async () => ({ statusCode: 'PUBLISHED' as const, status: null })),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    expect(t.store.markFailed).toHaveBeenCalledWith('p1', INSTAGRAM_LOST_ERROR)
  })

  it('records the reel when the publish call drops but Instagram published it', async () => {
    const statuses = ['FINISHED', 'PUBLISHED'] as const
    let i = 0
    const t = await setup({
      official: {
        getContainerStatus: vi.fn(async () => ({ statusCode: statuses[i++]!, status: null })),
        publish: vi.fn(async () => Promise.reject(apiError('network', false))),
        listMediaSince: vi.fn(async () => [
          { id: 'taken', caption: null, permalink: null, timestamp: new Date(NOW) },
          { id: 'm7', caption: null, permalink: null, timestamp: new Date(NOW.getTime() + 5000) },
        ]),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: true })
    expect(t.store.markPosted).toHaveBeenCalledWith('p1', {
      mediaPk: 'm7',
      permalink: 'https://www.instagram.com/reel/ABC/',
    })
  })

  it('never re-sends a publish whose outcome is unknown', async () => {
    const t = await setup({
      official: { publish: vi.fn(async () => Promise.reject(apiError('network', false))) },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    expect(t.client.publish).toHaveBeenCalledTimes(1)
    expect(t.store.markFailed).toHaveBeenCalledWith('p1', INSTAGRAM_LOST_ERROR)
    expect(t.store.release).not.toHaveBeenCalled()
    expect(t.official.containers.get('p1')).toBe('c1')
  })

  it('retries later with the same container when the daily limit refuses the publish', async () => {
    const t = await setup({
      official: {
        publish: vi.fn(async () => Promise.reject(apiError('rate_limited', true, 'Limit hit.'))),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    expect(t.store.release).toHaveBeenCalledWith('p1', expect.stringMatching(/rate limit/i))
    expect(t.store.markFailed).not.toHaveBeenCalled()
    expect(t.official.containers.get('p1')).toBe('c1')
  })

  it('does not create a container once the publishing quota is used up', async () => {
    const t = await setup({
      official: { getPublishingLimit: vi.fn(async () => ({ used: 100, total: 100 })) },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    expect(t.client.createReelContainer).not.toHaveBeenCalled()
    expect(t.store.release).toHaveBeenCalledWith('p1', expect.stringMatching(/100 of 100/))
  })

  it('posts anyway when the quota cannot be read', async () => {
    const t = await setup({
      official: {
        getPublishingLimit: vi.fn(async () => Promise.reject(apiError('transient'))),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: true })
  })

  it('keeps the post queued and asks for a new token when the token is rejected', async () => {
    const t = await setup({
      official: {
        createReelContainer: vi.fn(async () => Promise.reject(apiError('token_invalid'))),
      },
    })
    expect(await runInstagramQueue(t.deps)).toMatchObject({ ok: false })
    expect(t.store.release).toHaveBeenCalledWith('p1', expect.stringMatching(/access token/))
    expect(t.official.account()?.state).toBe('needs_login')
    expect(t.store.markFailed).not.toHaveBeenCalled()
  })

  it('fails the post with Instagram’s reason when the upload is rejected', async () => {
    const t = await setup({
      official: {
        createReelContainer: vi.fn(async () =>
          Promise.reject(apiError('rejected', true, 'The video format is not supported.')),
        ),
      },
    })
    await runInstagramQueue(t.deps)
    expect(t.store.markFailed).toHaveBeenCalledWith('p1', 'The video format is not supported.')
  })

  it('retries a network failure, then gives up after repeated attempts', async () => {
    const down = {
      createReelContainer: vi.fn(async () => Promise.reject(apiError('network', false))),
    }
    const first = await setup({ official: down })
    await runInstagramQueue(first.deps)
    expect(first.store.release).toHaveBeenCalled()
    const last = await setup({
      official: down,
      post: { ...POST, attempts: MAX_TRANSIENT_ATTEMPTS },
    })
    await runInstagramQueue(last.deps)
    expect(last.store.markFailed).toHaveBeenCalled()
  })

  it('deletes a reel it posted itself', async () => {
    const t = await setup({
      del: { ...POST, id: 'p5', media_pk: 'm5' },
      containers: { p5: 'c5' },
    })
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'delete', postId: 'p5', ok: true })
    expect(t.client.deleteMedia).toHaveBeenCalledWith(RAW_TOKEN, 'm5')
    expect(t.store.markDeleted).toHaveBeenCalledWith('p5')
    expect(t.store.claimPost).not.toHaveBeenCalled()
  })

  it('keeps the post and passes on Meta’s reason when the delete is refused', async () => {
    const t = await setup({
      del: { ...POST, id: 'p5', media_pk: 'm5' },
      containers: { p5: 'c5' },
      official: {
        deleteMedia: vi.fn(async () =>
          Promise.reject(apiError('permission', true, 'Requires instagram_manage_contents.')),
        ),
      },
    })
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'delete', postId: 'p5', ok: false })
    expect(t.store.markDeleted).not.toHaveBeenCalled()
    expect(t.store.restoreAfterDeleteFailure).toHaveBeenCalledWith(
      'p5',
      expect.stringMatching(/Requires instagram_manage_contents\..*Instagram app/),
    )
  })

  it('does not try to delete a reel the unofficial publisher posted', async () => {
    const t = await setup({ del: { ...POST, id: 'p5', media_pk: '3712' } })
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'delete', postId: 'p5', ok: false })
    expect(t.client.deleteMedia).not.toHaveBeenCalled()
    expect(t.store.restoreAfterDeleteFailure).toHaveBeenCalledWith('p5', UNOFFICIAL_DELETE_MESSAGE)
  })
})

describe('lost posts with the official publisher', () => {
  const live = {
    id: 'm3',
    caption: 'lost cap',
    permalink: 'https://www.instagram.com/reel/L/',
    timestamp: new Date('2026-11-16T11:31:00Z'),
  }

  it('settles a published container as posted', async () => {
    const t = await setup({
      lost: LOST,
      post: null,
      containers: { p0: 'c0' },
      official: {
        getContainerStatus: vi.fn(async () => ({ statusCode: 'PUBLISHED' as const, status: null })),
        listMediaSince: vi.fn(async () => [live]),
      },
    })
    await runInstagramQueue(t.deps)
    expect(t.store.markLostFound).toHaveBeenCalledWith('p0', {
      mediaPk: 'm3',
      permalink: live.permalink,
    })
  })

  it('settles an unpublished container as safe to queue again', async () => {
    const t = await setup({ lost: LOST, post: null, containers: { p0: 'c0' } })
    await runInstagramQueue(t.deps)
    expect(t.store.markLostNotFound).toHaveBeenCalledWith('p0')
    expect(t.client.listMediaSince).not.toHaveBeenCalled()
  })

  it('keeps looking when the container is published but the reel is not listed yet', async () => {
    const t = await setup({
      lost: LOST,
      post: null,
      containers: { p0: 'c0' },
      official: {
        getContainerStatus: vi.fn(async () => ({ statusCode: 'PUBLISHED' as const, status: null })),
      },
    })
    await runInstagramQueue(t.deps)
    expect(t.store.markLostFound).not.toHaveBeenCalled()
    expect(t.store.markLostNotFound).not.toHaveBeenCalled()
  })

  it('looks up a lost upload from the unofficial publisher by caption only', async () => {
    const found = await setup({
      lost: LOST,
      post: null,
      official: { listMediaSince: vi.fn(async () => [live]) },
    })
    await runInstagramQueue(found.deps)
    expect(found.store.markLostFound).toHaveBeenCalled()
    const other = await setup({
      lost: LOST,
      post: null,
      official: { listMediaSince: vi.fn(async () => [{ ...live, caption: 'another reel' }]) },
    })
    await runInstagramQueue(other.deps)
    expect(other.store.markLostNotFound).toHaveBeenCalledWith('p0')
  })

  it('leaves the post alone when the lookup fails', async () => {
    const t = await setup({
      lost: LOST,
      post: null,
      containers: { p0: 'c0' },
      official: {
        getContainerStatus: vi.fn(async () => Promise.reject(apiError('network', false))),
      },
    })
    await runInstagramQueue(t.deps)
    expect(t.store.markLostFound).not.toHaveBeenCalled()
    expect(t.store.markLostNotFound).not.toHaveBeenCalled()
  })
})
