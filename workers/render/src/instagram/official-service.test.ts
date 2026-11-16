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
  OFFICIAL_DELETE_MESSAGE,
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

const TOKEN: StoredToken = {
  accessToken: RAW_TOKEN,
  userId: OFFICIAL_ME.userId,
  username: OFFICIAL_ME.username,
  savedAt: ago(2 * DAY),
  refreshedAt: ago(2 * DAY),
  expiresAt: ahead(58 * DAY),
  expiryKnown: true,
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
  it('validates the token with /me and saves it encrypted with the account', async () => {
    const t = await setup({ token: null, account: null })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(t.client.getAccount).toHaveBeenCalledWith(RAW_TOKEN)
    expect(account).toMatchObject({
      state: 'connected',
      username: 'reelset_app',
      publisher: 'official',
      tokenExpiresAt: ahead(60 * DAY),
    })
    expect(t.official.token()).not.toContain(RAW_TOKEN)
    expect(await t.savedToken()).toMatchObject({
      accessToken: RAW_TOKEN,
      userId: OFFICIAL_ME.userId,
      expiryKnown: false,
      refreshedAt: null,
    })
    expect(t.official.account()?.state).toBe('connected')
  })

  it('does not save a token Instagram rejects', async () => {
    const t = await setup({
      token: null,
      account: null,
      official: { getAccount: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    const account = await connectOfficialAccount(t.deps, RAW_TOKEN)
    expect(account.state).toBe('needs_login')
    expect(account.message).toMatch(/rejected the access token/)
    expect(t.store.saveOfficialToken).not.toHaveBeenCalled()
    expect(t.official.account()?.state).toBe('needs_login')
  })

  it('keeps a working token and its record when a replacement is rejected', async () => {
    const t = await setup({
      official: { getAccount: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    const account = await connectOfficialAccount(t.deps, 'IGAAanotherbadtoken000000000')
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
  it('reports no token as disconnected without calling Instagram', async () => {
    const t = await setup({ token: null, account: null })
    expect((await checkOfficialAccount(t.deps)).state).toBe('disconnected')
    expect(t.client.getAccount).not.toHaveBeenCalled()
  })

  it('turns an expired token into needs_login and a restricted account into challenge', async () => {
    const expired = await setup({
      official: { getAccount: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    expect((await checkOfficialAccount(expired.deps)).state).toBe('needs_login')
    const restricted = await setup({
      official: { getAccount: vi.fn(async () => Promise.reject(apiError('account_restricted'))) },
    })
    expect((await checkOfficialAccount(restricted.deps)).state).toBe('challenge')
  })

  it('leaves the state unknown when Instagram cannot be reached', async () => {
    const t = await setup({
      official: { getAccount: vi.fn(async () => Promise.reject(apiError('network', false))) },
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
  it('does nothing without a token', async () => {
    const t = await setup({ token: null })
    expect(await refreshOfficialToken(t.deps)).toBe('no_token')
  })

  it('leaves a token younger than 24 hours alone, even a freshly pasted one', async () => {
    const t = await setup({
      token: { ...TOKEN, savedAt: ago(DAY - 60_000), refreshedAt: null, expiryKnown: false },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('not_due')
    expect(t.client.refreshToken).not.toHaveBeenCalled()
  })

  it('refreshes a pasted token once it is a day old, which reveals its real expiry', async () => {
    const t = await setup({
      token: { ...TOKEN, savedAt: ago(DAY + 60_000), refreshedAt: null, expiryKnown: false },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('refreshed')
    expect(t.client.refreshToken).toHaveBeenCalledWith(RAW_TOKEN)
    expect(await t.savedToken()).toMatchObject({
      accessToken: 'fresh-token',
      refreshedAt: NOW.toISOString(),
      expiresAt: ahead(5_184_000_000),
      expiryKnown: true,
    })
    expect(t.official.account()?.tokenExpiresAt).toBe(ahead(5_184_000_000))
    expect(t.alert).not.toHaveBeenCalled()
  })

  it('refreshes a known token only after 7 days', async () => {
    const young = await setup({ token: { ...TOKEN, refreshedAt: ago(6 * DAY) } })
    expect(await refreshOfficialToken(young.deps)).toBe('not_due')
    const old = await setup({ token: { ...TOKEN, refreshedAt: ago(7 * DAY + 1) } })
    expect(await refreshOfficialToken(old.deps)).toBe('refreshed')
  })

  it('alerts when a refresh fails and waits 6 hours before trying again', async () => {
    const t = await setup({
      token: { ...TOKEN, refreshedAt: ago(8 * DAY) },
      official: { refreshToken: vi.fn(async () => Promise.reject(apiError('transient'))) },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('failed')
    expect(t.alert).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'instagram_token_refresh_failed' }),
    )
    expect((await t.savedToken())?.accessToken).toBe(RAW_TOKEN)
    t.advance(5 * 60_000)
    expect(await refreshOfficialToken(t.deps)).toBe('not_due')
    expect(t.client.refreshToken).toHaveBeenCalledTimes(1)
    t.advance(6 * 60 * 60_000)
    expect(await refreshOfficialToken(t.deps)).toBe('failed')
    expect(t.client.refreshToken).toHaveBeenCalledTimes(2)
  })

  it('marks the account needs_login when the refresh says the token is dead', async () => {
    const t = await setup({
      token: { ...TOKEN, refreshedAt: ago(8 * DAY) },
      official: { refreshToken: vi.fn(async () => Promise.reject(apiError('token_invalid'))) },
    })
    await refreshOfficialToken(t.deps)
    expect(t.official.account()?.state).toBe('needs_login')
  })

  it('alerts once a day while the token is within 7 days of expiry', async () => {
    const t = await setup({
      token: { ...TOKEN, refreshedAt: ago(54 * DAY), expiresAt: ahead(6 * DAY) },
      official: { refreshToken: vi.fn(async () => Promise.reject(apiError('transient'))) },
    })
    await refreshOfficialToken(t.deps)
    const expiring = () => t.alert.mock.calls.filter(([a]) => a.key === 'instagram_token_expiring')
    expect(expiring()).toHaveLength(1)
    t.advance(5 * 60_000)
    await refreshOfficialToken(t.deps)
    expect(expiring()).toHaveLength(1)
    t.advance(DAY)
    await refreshOfficialToken(t.deps)
    expect(expiring()).toHaveLength(2)
  })

  it('does not warn about expiry after a successful refresh', async () => {
    const t = await setup({
      token: { ...TOKEN, refreshedAt: ago(54 * DAY), expiresAt: ahead(6 * DAY) },
    })
    expect(await refreshOfficialToken(t.deps)).toBe('refreshed')
    expect(t.alert).not.toHaveBeenCalled()
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

  it('refuses a delete in plain words and leaves the post as posted', async () => {
    const t = await setup({ del: { ...POST, id: 'p5', media_pk: 'm5' } })
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'delete', postId: 'p5', ok: false })
    expect(t.store.restoreAfterDeleteFailure).toHaveBeenCalledWith('p5', OFFICIAL_DELETE_MESSAGE)
    expect(t.store.claimPost).not.toHaveBeenCalled()
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
