import { describe, expect, it, vi } from 'vitest'
import type { IgAccount } from '@reelset/core'
import { silentLog } from '../testing'
import { IgCallError, type IgContainerClient } from './container-client'
import { encryptJson, importSessionKey } from './crypto'
import { checkAccount, connectAccount, runInstagramQueue, type IgDeps } from './service'
import type { ClaimedPost, IgStore } from './store'

const KEY = await importSessionKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(3))))
const PROXY = { index: 1, country: 'US', switched: false, down: false }
const POST: ClaimedPost = {
  id: 'p1',
  item_id: 'i1',
  video_key: 'reels/i1/k.mp4',
  caption: 'cap',
  media_pk: null,
  attempts: 1,
}
const connected: IgAccount = {
  username: 'reelset',
  state: 'connected',
  message: null,
  checkedAt: '2026-11-11T00:00:00.000Z',
  loginFailures: 0,
}

async function setup(
  opts: { account?: IgAccount | null; session?: boolean; post?: ClaimedPost | null } = {},
) {
  const calls: string[] = []
  let account = opts.account === undefined ? connected : opts.account
  const session =
    opts.session === false
      ? null
      : await encryptJson(KEY, { session: { uuids: {} }, proxyIndex: null })
  const store: IgStore = {
    getSession: async () => session,
    saveSession: vi.fn(async () => {}),
    getAccount: async () => account,
    setAccount: async (a) => {
      account = a
    },
    claimPost: vi.fn(async () => (opts.post === undefined ? POST : opts.post)),
    claimDelete: vi.fn(async () => null),
    markPosted: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    release: vi.fn(async () => true),
    markDeleted: vi.fn(async () => true),
    restoreAfterDeleteFailure: vi.fn(async () => true),
    failStuck: vi.fn(async () => 0),
  }
  const client: IgContainerClient = {
    status: vi.fn(async () => ({
      state: 'connected' as const,
      username: 'reelset',
      message: null,
      session: { a: 1 },
      proxy: PROXY,
    })),
    login: vi.fn(async () => ({
      state: 'connected' as const,
      username: 'reelset',
      message: null,
      session: { a: 2 },
      proxy: PROXY,
    })),
    post: vi.fn(async () => ({
      mediaPk: '99',
      permalink: 'https://www.instagram.com/p/X/',
      session: { a: 3 },
      proxy: PROXY,
    })),
    remove: vi.fn(async () => ({ deleted: true, session: { a: 4 }, proxy: PROXY })),
  }
  const deps: IgDeps = {
    store,
    client,
    key: KEY,
    creds: { username: 'reelset', password: 'pw' },
    mediaBaseUrl: 'https://media.reelset.app',
    log: silentLog,
  }
  return { deps, store, client, calls, account: () => account }
}

describe('runInstagramQueue', () => {
  it('does nothing and never claims while the account is not connected', async () => {
    const t = await setup({ account: { ...connected, state: 'needs_login' } })
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'none', reason: 'not_connected' })
    expect(t.store.claimPost).not.toHaveBeenCalled()
  })

  it('posts the claimed job with the full media url and stores the result', async () => {
    const t = await setup()
    const out = await runInstagramQueue(t.deps)
    expect(out).toEqual({ ran: 'post', postId: 'p1', ok: true })
    expect(t.client.post).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.anything() }),
      'https://media.reelset.app/reels/i1/k.mp4',
      'cap',
    )
    expect(t.store.markPosted).toHaveBeenCalledWith('p1', {
      mediaPk: '99',
      permalink: 'https://www.instagram.com/p/X/',
    })
  })

  it('returns the job to the queue and flags the account when the session died', async () => {
    const t = await setup()
    vi.mocked(t.client.post).mockRejectedValueOnce(new IgCallError('needs_login', 'expired', true))
    const out = await runInstagramQueue(t.deps)
    expect(out).toMatchObject({ ran: 'post', ok: false })
    expect(t.store.release).toHaveBeenCalledWith('p1', 'expired')
    expect(t.store.markFailed).not.toHaveBeenCalled()
    expect(t.account()?.state).toBe('needs_login')
  })

  it('fails (never re-sends) when the container was unreachable mid-upload', async () => {
    const t = await setup()
    vi.mocked(t.client.post).mockRejectedValueOnce(new IgCallError('unreachable', 'x', false))
    await runInstagramQueue(t.deps)
    expect(t.store.markFailed).toHaveBeenCalledWith(
      'p1',
      expect.stringContaining('outcome unknown'),
    )
    expect(t.store.release).not.toHaveBeenCalled()
  })

  it('records the container message for a known upload failure', async () => {
    const t = await setup()
    vi.mocked(t.client.post).mockRejectedValueOnce(
      new IgCallError('upload_failed', 'video too long', true),
    )
    await runInstagramQueue(t.deps)
    expect(t.store.markFailed).toHaveBeenCalledWith('p1', 'video too long')
  })

  it('reports nothing_due when the claim returns no job (gap or empty queue)', async () => {
    const t = await setup({ post: null })
    expect(await runInstagramQueue(t.deps)).toEqual({ ran: 'none', reason: 'nothing_due' })
    expect(t.client.post).not.toHaveBeenCalled()
  })

  it('runs a delete before a post and restores the post if the delete fails', async () => {
    const t = await setup()
    vi.mocked(t.store.claimDelete).mockResolvedValueOnce({ ...POST, media_pk: '55' })
    vi.mocked(t.client.remove).mockRejectedValueOnce(new IgCallError('delete_failed', 'nope', true))
    const out = await runInstagramQueue(t.deps)
    expect(out).toMatchObject({ ran: 'delete', ok: false })
    expect(t.store.restoreAfterDeleteFailure).toHaveBeenCalledWith('p1', 'nope')
    expect(t.store.claimPost).not.toHaveBeenCalled()
  })
})

describe('connectAccount / checkAccount', () => {
  it('a successful login resets failures and stores the session', async () => {
    const t = await setup({ account: { ...connected, state: 'needs_login', loginFailures: 2 } })
    const acc = await connectAccount(t.deps, '123456')
    expect(acc).toMatchObject({ state: 'connected', loginFailures: 0 })
    expect(t.store.saveSession).toHaveBeenCalled()
  })

  it('counts a rejected login but not a missing 2FA code', async () => {
    const t = await setup({ account: { ...connected, state: 'needs_login', loginFailures: 1 } })
    vi.mocked(t.client.login).mockResolvedValueOnce({
      state: 'needs_code',
      username: null,
      message: 'code',
      session: null,
      proxy: PROXY,
    })
    expect((await connectAccount(t.deps)).loginFailures).toBe(1)
    vi.mocked(t.client.login).mockResolvedValueOnce({
      state: 'challenge',
      username: null,
      message: 'approve',
      session: null,
      proxy: PROXY,
    })
    expect((await connectAccount(t.deps, '111111')).loginFailures).toBe(2)
  })

  it('blocks on a dead proxy: releases the job and shows the proxy down', async () => {
    const t = await setup()
    vi.mocked(t.client.post).mockRejectedValueOnce(
      new IgCallError('proxy_down', 'proxy not responding', true),
    )
    await runInstagramQueue(t.deps)
    expect(t.store.release).toHaveBeenCalledWith('p1', 'proxy not responding')
    expect(t.store.markFailed).not.toHaveBeenCalled()
    expect(t.account()?.proxy?.down).toBe(true)
    expect(t.account()?.state).toBe('connected')
  })

  it('sends the pinned proxy index with each call and keeps it in the encrypted session', async () => {
    const t = await setup()
    await runInstagramQueue(t.deps)
    expect(t.client.post).toHaveBeenCalledWith(
      expect.objectContaining({ proxyIndex: null }),
      expect.any(String),
      'cap',
    )
    const blob = vi.mocked(t.store.saveSession).mock.calls[0]?.[0] ?? ''
    expect(blob).not.toContain('proxyIndex')
    await runInstagramQueue(t.deps)
  })

  it('a status check never logs in', async () => {
    const t = await setup()
    await checkAccount(t.deps)
    expect(t.client.login).not.toHaveBeenCalled()
    expect(t.account()?.state).toBe('connected')
    expect(t.account()?.proxy).toEqual(PROXY)
  })

  it('a transport error leaves the account unknown and does not count a failure', async () => {
    const t = await setup()
    vi.mocked(t.client.status).mockRejectedValueOnce(new IgCallError('unreachable', 'x', false))
    expect(await checkAccount(t.deps)).toMatchObject({ state: 'unknown', loginFailures: 0 })
  })
})
