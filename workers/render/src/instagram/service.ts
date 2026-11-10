import {
  errorFields,
  type IgAccount,
  type IgAccountState,
  type IgProxy,
  type Logger,
} from '@reelset/core'
import { decryptJson, encryptJson } from './crypto'
import {
  IgCallError,
  type IgContainerClient,
  type IgCredentials,
  type IgSession,
  type IgState,
} from './container-client'
import type { ClaimedPost, IgStore } from './store'

export type IgDeps = {
  store: IgStore
  client: IgContainerClient
  key: CryptoKey
  creds: IgCredentials
  mediaBaseUrl: string
  log: Logger
  now?: () => Date
}

const SESSION_LOST_STATES: readonly string[] = ['needs_login', 'needs_code', 'challenge']
const PROXY_DOWN = 'proxy_down'
const UNREACHABLE_MESSAGE = 'Poster unreachable, try again.'

async function loadState(deps: IgDeps): Promise<IgState> {
  const blob = await deps.store.getSession()
  if (!blob) return { session: null, proxyIndex: null }
  try {
    const value = (await decryptJson(deps.key, blob)) as Partial<IgState> | null
    const session = value?.session && typeof value.session === 'object' ? value.session : null
    const proxyIndex = typeof value?.proxyIndex === 'number' ? value.proxyIndex : null
    return { session, proxyIndex }
  } catch (err) {
    deps.log.error(errorFields(err), 'stored instagram session could not be decrypted')
    return { session: null, proxyIndex: null }
  }
}

async function saveState(deps: IgDeps, session: IgSession, proxy: IgProxy): Promise<void> {
  await deps.store.saveSession(await encryptJson(deps.key, { session, proxyIndex: proxy.index }))
}

type AccountPatch = {
  state?: IgAccountState
  message: string | null
  username?: string | null
  proxy?: IgProxy | null
}

async function writeAccount(
  deps: IgDeps,
  patch: AccountPatch,
  failures: (previous: number) => number,
): Promise<IgAccount> {
  const previous = await deps.store.getAccount()
  const account: IgAccount = {
    username: patch.username ?? previous?.username ?? deps.creds.username,
    state: patch.state ?? previous?.state ?? 'unknown',
    message: patch.message,
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    loginFailures: failures(previous?.loginFailures ?? 0),
    proxy: patch.proxy === undefined ? (previous?.proxy ?? null) : patch.proxy,
  }
  await deps.store.setAccount(account)
  return account
}

async function recordProxyDown(deps: IgDeps, err: IgCallError): Promise<IgAccount> {
  const previous = await deps.store.getAccount()
  const proxy: IgProxy = {
    ...(previous?.proxy ?? { index: 0, country: null, switched: false }),
    down: true,
  }
  return writeAccount(deps, { message: err.message, proxy }, (n) => n)
}

function switchNote(proxy: IgProxy): string | null {
  return proxy.switched ? 'The pinned proxy was down, so a backup proxy is in use.' : null
}

// Read-only check with the saved session: never logs in, never leaves the pinned proxy unprobed.
export async function checkAccount(deps: IgDeps): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-status' })
  const state = await loadState(deps)
  try {
    const result = await deps.client.status(state)
    if (result.session) await saveState(deps, result.session, result.proxy)
    log.info({ state: result.state, switched: result.proxy.switched }, 'instagram account checked')
    return writeAccount(
      deps,
      {
        state: result.state,
        message: result.message ?? switchNote(result.proxy),
        username: result.username,
        proxy: result.proxy,
      },
      (n) => n,
    )
  } catch (err) {
    log.error(errorFields(err), 'instagram status check failed')
    if (err instanceof IgCallError && err.code === PROXY_DOWN) return recordProxyDown(deps, err)
    return writeAccount(deps, { state: 'unknown', message: UNREACHABLE_MESSAGE }, (n) => n)
  }
}

// One explicit login attempt (admin click); a missing 2FA code is not counted as a failure.
export async function connectAccount(deps: IgDeps, code?: string): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-connect' })
  const state = await loadState(deps)
  try {
    const result = await deps.client.login(state, deps.creds, code)
    if (result.state === 'connected' && result.session) {
      await saveState(deps, result.session, result.proxy)
      log.info('instagram connected')
      return writeAccount(
        deps,
        {
          state: 'connected',
          message: switchNote(result.proxy),
          username: result.username,
          proxy: result.proxy,
        },
        () => 0,
      )
    }
    log.warn({ state: result.state }, 'instagram login did not complete')
    const counted = result.state !== 'needs_code'
    return writeAccount(
      deps,
      { state: result.state, message: result.message, proxy: result.proxy },
      (n) => (counted ? n + 1 : n),
    )
  } catch (err) {
    log.error(errorFields(err), 'instagram login call failed')
    if (err instanceof IgCallError && err.code === PROXY_DOWN) return recordProxyDown(deps, err)
    return writeAccount(deps, { state: 'unknown', message: UNREACHABLE_MESSAGE }, (n) => n)
  }
}

export type QueueOutcome =
  | { ran: 'none'; reason: 'not_connected' | 'nothing_due' }
  | { ran: 'post' | 'delete'; postId: string; ok: boolean }

const OUTCOME_UNKNOWN = 'Upload outcome unknown. Check Instagram before queueing this reel again.'

async function runPost(deps: IgDeps, post: ClaimedPost, state: IgState): Promise<boolean> {
  const log = deps.log.child({ postId: post.id, itemId: post.item_id })
  const url = `${deps.mediaBaseUrl.replace(/\/$/, '')}/${post.video_key.replace(/^\//, '')}`
  try {
    const result = await deps.client.post(state, url, post.caption)
    await saveState(deps, result.session, result.proxy)
    await deps.store.markPosted(post.id, { mediaPk: result.mediaPk, permalink: result.permalink })
    await writeAccount(deps, { message: switchNote(result.proxy), proxy: result.proxy }, (n) => n)
    log.info({ mediaPk: result.mediaPk }, 'instagram post published')
    return true
  } catch (err) {
    log.error(errorFields(err), 'instagram post failed')
    if (err instanceof IgCallError && err.code === PROXY_DOWN) {
      await deps.store.release(post.id, err.message)
      await recordProxyDown(deps, err)
      return false
    }
    if (err instanceof IgCallError && SESSION_LOST_STATES.includes(err.code)) {
      await deps.store.release(post.id, err.message)
      await writeAccount(
        deps,
        { state: err.code as IgAccountState, message: err.message },
        (n) => n,
      )
      return false
    }
    const known = err instanceof IgCallError && err.reachedContainer
    await deps.store.markFailed(post.id, known ? err.message : OUTCOME_UNKNOWN)
    return false
  }
}

async function runDelete(deps: IgDeps, post: ClaimedPost, state: IgState): Promise<boolean> {
  const log = deps.log.child({ postId: post.id, mediaPk: post.media_pk })
  try {
    const result = await deps.client.remove(state, post.media_pk ?? '')
    await saveState(deps, result.session, result.proxy)
    if (!result.deleted) {
      throw new IgCallError('delete_failed', 'Instagram did not confirm the delete', true)
    }
    await deps.store.markDeleted(post.id)
    log.info('instagram post deleted')
    return true
  } catch (err) {
    log.error(errorFields(err), 'instagram delete failed')
    await deps.store.restoreAfterDeleteFailure(
      post.id,
      err instanceof Error ? err.message : 'delete failed',
    )
    if (err instanceof IgCallError && err.code === PROXY_DOWN) await recordProxyDown(deps, err)
    else if (err instanceof IgCallError && SESSION_LOST_STATES.includes(err.code)) {
      await writeAccount(
        deps,
        { state: err.code as IgAccountState, message: err.message },
        (n) => n,
      )
    }
    return false
  }
}

// At most one Instagram operation per run; the claim query enforces the gap between posts.
export async function runInstagramQueue(deps: IgDeps): Promise<QueueOutcome> {
  await deps.store.failStuck()
  const account = await deps.store.getAccount()
  if (account?.state !== 'connected') return { ran: 'none', reason: 'not_connected' }
  const state = await loadState(deps)
  if (!state.session) return { ran: 'none', reason: 'not_connected' }

  const del = await deps.store.claimDelete()
  if (del) return { ran: 'delete', postId: del.id, ok: await runDelete(deps, del, state) }
  const post = await deps.store.claimPost()
  if (post) return { ran: 'post', postId: post.id, ok: await runPost(deps, post, state) }
  return { ran: 'none', reason: 'nothing_due' }
}
