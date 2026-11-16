import {
  INSTAGRAM_LOST_ERROR,
  errorFields,
  type AlertInput,
  type IgAccount,
  type IgAccountState,
  type IgProxy,
  type InstagramPublisher,
  type Logger,
} from '@reelset/core'
import { decryptJson, encryptJson } from './crypto'
import {
  IG_TIMEOUT_MS,
  IN_PROGRESS,
  IgCallError,
  TIMEOUT,
  type IgContainerClient,
  type IgCredentials,
  type IgReelUpload,
  type IgSession,
  type IgState,
} from './container-client'
import { posterKeyForVideoKey } from '../keys'
import type { OfficialClient } from './official-client'
import {
  checkOfficialAccount,
  connectOfficialAccount,
  disconnectOfficialAccount,
  runOfficialQueue,
} from './official-service'
import type { ClaimedPost, IgStore, LostPost } from './store'

export type IgDeps = {
  store: IgStore
  client: IgContainerClient
  key: CryptoKey
  /** IG_USERNAME / IG_PASSWORD secrets; credentials entered in the admin take precedence. */
  envCreds: IgCredentials | null
  mediaBaseUrl: string
  log: Logger
  now?: () => Date
  /** Meta's official API; used when the `instagram_publisher` setting is `official`. */
  official: OfficialClient
  publisher: () => Promise<InstagramPublisher>
  aiLabel: () => Promise<boolean>
  alert: (input: AlertInput) => Promise<unknown>
  sleep?: (ms: number) => Promise<void>
}

const SESSION_LOST_STATES: readonly string[] = ['needs_login', 'needs_code', 'challenge']
const PROXY_DOWN = 'proxy_down'
const BUSY = 'busy'
const UNREACHABLE_MESSAGE = 'Poster unreachable, try again.'
const SLOW_LOGIN_MESSAGE =
  'Instagram login is taking too long (the poster is busy rendering). Try again in a few minutes.'
const BUSY_LOGIN_MESSAGE = 'The poster is busy with another Instagram job. Try again in a minute.'
// A login that outlives one box call is polled with the same body; the whole connect stays under
// the web action's 280 s.
export const LOGIN_BUDGET_MS = 240_000

async function loginWithPolling(deps: IgDeps, state: IgState, creds: IgCredentials, code?: string) {
  const clock = () => (deps.now?.() ?? new Date()).getTime()
  const started = clock()
  for (;;) {
    try {
      return await deps.client.login(state, creds, code)
    } catch (err) {
      if (!(err instanceof IgCallError) || err.code !== IN_PROGRESS) throw err
      if (clock() - started + IG_TIMEOUT_MS.login > LOGIN_BUDGET_MS)
        throw new IgCallError(TIMEOUT, 'instagram login did not finish in time', true)
      deps.log.info({ waitedMs: clock() - started }, 'instagram login still running, polling')
    }
  }
}

// Post, delete and find keep running on the box after a call gives up; the worker polls with the same
// body for up to this long (the queue consumer allows 15 min, shared with the lost-post lookup).
export const POLL_BUDGET_MS = 12 * 60_000
export const RUN_BUDGET_MS = 14 * 60_000
const POLL_AGAIN_CODES: readonly string[] = [IN_PROGRESS, TIMEOUT, 'gateway']

async function pollBox<T>(
  deps: IgDeps,
  op: string,
  log: Logger,
  call: () => Promise<T>,
  budgetMs = POLL_BUDGET_MS,
): Promise<T> {
  const clock = () => (deps.now?.() ?? new Date()).getTime()
  const started = clock()
  let polls = 0
  let sawInProgress = false
  for (;;) {
    polls += 1
    try {
      const result = await call()
      if (polls > 1) log.info({ op, polls }, 'instagram box finished after polling')
      return result
    } catch (err) {
      if (!(err instanceof IgCallError) || !POLL_AGAIN_CODES.includes(err.code)) throw err
      if (err.code === IN_PROGRESS) sawInProgress = true
      else if (!sawInProgress && !(await deps.client.supportsJobs())) {
        log.warn({ op, code: err.code }, 'box cannot join a lost call, not sending it again')
        throw err
      }
      const waited = clock() - started
      if (waited + IG_TIMEOUT_MS.post > budgetMs) {
        log.warn(
          { op, polls, waitedMs: waited, sawInProgress },
          'instagram box still busy, giving up',
        )
        throw new IgCallError(TIMEOUT, `instagram ${op} did not finish in time`, false)
      }
      log.info(
        { op, polls, waitedMs: waited, code: err.code },
        'instagram box still working, polling',
      )
    }
  }
}

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

async function storedCreds(deps: IgDeps): Promise<IgCredentials | null> {
  const blob = await deps.store.getCredentials()
  if (!blob) return null
  try {
    const value = (await decryptJson(deps.key, blob)) as Partial<IgCredentials> | null
    if (typeof value?.username !== 'string' || typeof value.password !== 'string') return null
    return {
      username: value.username,
      password: value.password,
      ...(typeof value.totpSecret === 'string' ? { totpSecret: value.totpSecret } : {}),
    }
  } catch (err) {
    deps.log.error(errorFields(err), 'stored instagram credentials could not be decrypted')
    return null
  }
}

async function activeCreds(deps: IgDeps): Promise<IgCredentials | null> {
  return (await storedCreds(deps)) ?? deps.envCreds
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
    username: patch.username ?? previous?.username ?? deps.envCreds?.username ?? '',
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
  if (!state.session) {
    const previous = await deps.store.getAccount()
    if (previous?.state === 'disconnected') return previous
  }
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

export type ConnectInput = { code?: string; creds?: IgCredentials; accessToken?: string }

export async function checkActiveAccount(deps: IgDeps): Promise<IgAccount> {
  return (await deps.publisher()) === 'official' ? checkOfficialAccount(deps) : checkAccount(deps)
}

/**
 * An access token always goes to the official publisher, so it can be saved and checked before the
 * `instagram_publisher` setting is switched over.
 */
export async function connectActiveAccount(
  deps: IgDeps,
  input: ConnectInput = {},
): Promise<IgAccount> {
  if (input.accessToken) return connectOfficialAccount(deps, input.accessToken)
  if (!input.creds && (await deps.publisher()) === 'official') return checkOfficialAccount(deps)
  return connectAccount(deps, input)
}

export async function disconnectActiveAccount(deps: IgDeps): Promise<IgAccount> {
  return (await deps.publisher()) === 'official'
    ? disconnectOfficialAccount(deps)
    : disconnectAccount(deps)
}

/**
 * One explicit login attempt (admin click); a missing 2FA code is not counted as a failure.
 * New credentials start from scratch: they replace the saved ones and the old session's device
 * ids are dropped, so the login looks like a fresh device for that account.
 */
export async function connectAccount(deps: IgDeps, input: ConnectInput = {}): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-connect', newCreds: Boolean(input.creds) })
  const saved = await loadState(deps)
  let state = saved
  if (input.creds) {
    await deps.store.saveCredentials(await encryptJson(deps.key, input.creds))
    state = { session: null, proxyIndex: saved.proxyIndex }
    log.info('instagram credentials replaced from the admin')
  }
  const creds = input.creds ?? (await activeCreds(deps))
  if (!creds) {
    log.warn('instagram connect without any credentials')
    return writeAccount(
      deps,
      { state: 'disconnected', message: 'No credentials saved. Enter a username and password.' },
      (n) => n,
    )
  }
  try {
    const result = await loginWithPolling(deps, state, creds, input.code)
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
      {
        state: result.state,
        message: result.message,
        proxy: result.proxy,
        ...(input.creds ? { username: input.creds.username } : {}),
      },
      (n) => (counted ? n + 1 : n),
    )
  } catch (err) {
    log.error(errorFields(err), 'instagram login call failed')
    if (err instanceof IgCallError && err.code === PROXY_DOWN) return recordProxyDown(deps, err)
    const message =
      err instanceof IgCallError && err.code === TIMEOUT
        ? SLOW_LOGIN_MESSAGE
        : err instanceof IgCallError && err.code === BUSY
          ? BUSY_LOGIN_MESSAGE
          : UNREACHABLE_MESSAGE
    return writeAccount(deps, { state: 'unknown', message }, (n) => n)
  }
}

/**
 * Forgets the account on our side: session, device ids and admin-entered credentials. Queued posts
 * stay queued and wait until an account is connected again.
 */
export async function disconnectAccount(deps: IgDeps): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-disconnect' })
  const previous = await deps.store.getAccount()
  await deps.store.clearConnection()
  const account: IgAccount = {
    username: previous?.username ?? '',
    state: 'disconnected',
    message: null,
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    loginFailures: 0,
    proxy: previous?.proxy ?? null,
  }
  await deps.store.setAccount(account)
  log.info({ previousState: previous?.state ?? null }, 'instagram account disconnected')
  return account
}

export type QueueOutcome =
  | { ran: 'none'; reason: 'not_connected' | 'nothing_due' }
  | { ran: 'post' | 'delete'; postId: string; ok: boolean }

function mediaUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}`
}

// The app shows the render's poster image as the cover, so Instagram gets that same file.
function reelUpload(deps: IgDeps, post: ClaimedPost): IgReelUpload {
  const posterKey = posterKeyForVideoKey(post.video_key)
  return {
    videoUrl: mediaUrl(deps.mediaBaseUrl, post.video_key),
    posterUrl: posterKey ? mediaUrl(deps.mediaBaseUrl, posterKey) : null,
    caption: post.caption,
  }
}

async function runPost(
  deps: IgDeps,
  post: ClaimedPost,
  state: IgState,
  budgetMs = POLL_BUDGET_MS,
): Promise<boolean> {
  const log = deps.log.child({ postId: post.id, itemId: post.item_id })
  const upload = reelUpload(deps, post)
  if (!upload.posterUrl)
    log.warn({ videoKey: post.video_key }, 'no poster key for video, cover falls back to a frame')
  try {
    const result = await pollBox(deps, 'post', log, () => deps.client.post(state, upload), budgetMs)
    await saveState(deps, result.session, result.proxy)
    await deps.store.markPosted(post.id, { mediaPk: result.mediaPk, permalink: result.permalink })
    await writeAccount(deps, { message: switchNote(result.proxy), proxy: result.proxy }, (n) => n)
    log.info({ mediaPk: result.mediaPk }, 'instagram post published')
    return true
  } catch (err) {
    log.error(errorFields(err), 'instagram post failed')
    if (err instanceof IgCallError && err.code === BUSY) {
      await deps.store.release(post.id, err.message)
      return false
    }
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
    await deps.store.markFailed(post.id, known ? err.message : INSTAGRAM_LOST_ERROR)
    return false
  }
}

async function runDelete(
  deps: IgDeps,
  post: ClaimedPost,
  state: IgState,
  budgetMs = POLL_BUDGET_MS,
): Promise<boolean> {
  const log = deps.log.child({ postId: post.id, mediaPk: post.media_pk })
  try {
    const result = await pollBox(
      deps,
      'delete',
      log,
      () => deps.client.remove(state, post.media_pk ?? ''),
      budgetMs,
    )
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

/**
 * A post whose upload result was lost (the run died mid-upload) may be live anyway: look for it on
 * the account by caption and settle it as posted, or as safe to queue again. A failed lookup
 * leaves it for the next run.
 */
export async function recoverLostPost(
  deps: IgDeps,
  lost: LostPost,
  state: IgState,
  budgetMs = POLL_BUDGET_MS,
): Promise<'found' | 'not_found' | 'unknown'> {
  const log = deps.log.child({ postId: lost.id, itemId: lost.item_id, op: 'ig-find' })
  try {
    const exclude = await deps.store.recentMediaPks()
    const result = await pollBox(
      deps,
      'find',
      log,
      () => deps.client.find(state, lost.caption, lost.started_at, exclude),
      budgetMs,
    )
    await saveState(deps, result.session, result.proxy)
    if (result.found && result.mediaPk && result.permalink) {
      await deps.store.markLostFound(lost.id, {
        mediaPk: result.mediaPk,
        permalink: result.permalink,
      })
      log.info(
        { mediaPk: result.mediaPk, match: result.match, captionRestored: result.captionRestored },
        'lost instagram post found live, marked posted',
      )
      return 'found'
    }
    await deps.store.markLostNotFound(lost.id)
    log.warn('lost instagram post is not on the account, marked safe to requeue')
    return 'not_found'
  } catch (err) {
    log.warn(errorFields(err), 'lost instagram post lookup failed, will retry next run')
    return 'unknown'
  }
}

// At most one post or delete per run; the claim query enforces the gap between posts.
export async function runInstagramQueue(deps: IgDeps): Promise<QueueOutcome> {
  if ((await deps.publisher()) === 'official') return runOfficialQueue(deps)
  const stuck = await deps.store.failStuck()
  if (stuck > 0) deps.log.warn({ stuck }, 'instagram posts lost mid-upload, will look them up')
  const account = await deps.store.getAccount()
  if (account?.state !== 'connected') return { ran: 'none', reason: 'not_connected' }
  const state = await loadState(deps)
  if (!state.session) return { ran: 'none', reason: 'not_connected' }

  const clock = () => (deps.now?.() ?? new Date()).getTime()
  const runStarted = clock()
  const remaining = () => Math.min(POLL_BUDGET_MS, RUN_BUDGET_MS - (clock() - runStarted))
  const lost = await deps.store.nextLost()
  if (lost) await recoverLostPost(deps, lost, state, remaining())

  // Not enough of the consumer's wall time left for a poll: leave the work for the next run.
  if (remaining() < 2 * IG_TIMEOUT_MS.post) return { ran: 'none', reason: 'nothing_due' }
  const del = await deps.store.claimDelete()
  if (del)
    return { ran: 'delete', postId: del.id, ok: await runDelete(deps, del, state, remaining()) }
  const post = await deps.store.claimPost()
  if (post)
    return { ran: 'post', postId: post.id, ok: await runPost(deps, post, state, remaining()) }
  return { ran: 'none', reason: 'nothing_due' }
}
