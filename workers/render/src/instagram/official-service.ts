import {
  INSTAGRAM_LOST_ERROR,
  errorFields,
  type IgAccount,
  type IgAccountState,
  type Logger,
} from '@reelset/core'
import { posterKeyForVideoKey } from '../keys'
import { decryptJson, encryptJson } from './crypto'
import { OfficialApiError, type ContainerStatus, type OfficialMedia } from './official-client'
import type { IgDeps, QueueOutcome } from './service'
import type { ClaimedPost, LostPost } from './store'

const DAY_MS = 86_400_000
// Long-lived Instagram User tokens last 60 days; a refresh restarts the 60 days.
export const TOKEN_LIFETIME_MS = 60 * DAY_MS
export const TOKEN_REFRESH_AFTER_MS = 7 * DAY_MS
// Instagram refuses to refresh a token younger than 24 hours.
export const TOKEN_MIN_REFRESH_AGE_MS = DAY_MS
export const TOKEN_EXPIRY_WARNING_MS = 7 * DAY_MS
export const TOKEN_REFRESH_RETRY_MS = 6 * 60 * 60_000
export const TOKEN_EXPIRY_ALERT_EVERY_MS = DAY_MS

// Meta recommends checking a container about once a minute for at most 5 minutes.
export const CONTAINER_POLL_INTERVAL_MS = 30_000
export const CONTAINER_POLL_BUDGET_MS = 5 * 60_000
export const MAX_TRANSIENT_ATTEMPTS = 6
const PERMALINK_TRIES = 3
const PUBLISHED_LOOKBACK_MS = DAY_MS
const LOOKUP_SLACK_MS = 2 * 60_000

export const OFFICIAL_DELETE_MESSAGE =
  'The official Instagram API cannot delete posts. Delete the reel in the Instagram app, or set instagram_publisher to unofficial and delete it again.'
const NO_TOKEN_MESSAGE = 'No access token saved. Paste one to connect.'
const TOKEN_REJECTED_MESSAGE =
  'Instagram rejected the access token (invalid or expired). Paste a new one.'
const PERMISSION_MESSAGE =
  'The access token is missing a permission. It needs instagram_business_basic and instagram_business_content_publish.'
const STILL_PROCESSING_NOTE =
  'Instagram is still processing the video. Publishing continues on the next run.'
const BLOCKED_STATES: readonly IgAccountState[] = ['needs_login', 'challenge', 'disconnected']

export type StoredToken = {
  accessToken: string
  userId: string
  username: string
  savedAt: string
  refreshedAt: string | null
  expiresAt: string
  /** False until the first refresh: a pasted token's real expiry is not known. */
  expiryKnown: boolean
  refreshAttemptAt: string | null
  expiryAlertAt: string | null
}

const clock = (deps: IgDeps) => deps.now?.() ?? new Date()
const sleep = (deps: IgDeps, ms: number) =>
  deps.sleep ? deps.sleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function loadOfficialToken(deps: IgDeps): Promise<StoredToken | null> {
  const blob = await deps.store.getOfficialToken()
  if (!blob) return null
  try {
    const v = (await decryptJson(deps.key, blob)) as Partial<StoredToken> | null
    if (
      typeof v?.accessToken !== 'string' ||
      typeof v.userId !== 'string' ||
      typeof v.username !== 'string' ||
      typeof v.savedAt !== 'string' ||
      typeof v.expiresAt !== 'string'
    )
      return null
    return {
      accessToken: v.accessToken,
      userId: v.userId,
      username: v.username,
      savedAt: v.savedAt,
      refreshedAt: typeof v.refreshedAt === 'string' ? v.refreshedAt : null,
      expiresAt: v.expiresAt,
      expiryKnown: v.expiryKnown === true,
      refreshAttemptAt: typeof v.refreshAttemptAt === 'string' ? v.refreshAttemptAt : null,
      expiryAlertAt: typeof v.expiryAlertAt === 'string' ? v.expiryAlertAt : null,
    }
  } catch (err) {
    deps.log.error(errorFields(err), 'stored instagram access token could not be decrypted')
    return null
  }
}

async function saveToken(deps: IgDeps, token: StoredToken): Promise<void> {
  await deps.store.saveOfficialToken(await encryptJson(deps.key, token))
}

type OfficialPatch = {
  state: IgAccountState
  message: string | null
  username?: string
  tokenExpiresAt?: string | null
}

function officialAccount(deps: IgDeps, previous: IgAccount | null, patch: OfficialPatch) {
  const account: IgAccount = {
    username: patch.username ?? previous?.username ?? '',
    state: patch.state,
    message: patch.message,
    checkedAt: clock(deps).toISOString(),
    loginFailures: 0,
    proxy: null,
    publisher: 'official',
    tokenExpiresAt:
      patch.tokenExpiresAt === undefined
        ? (previous?.tokenExpiresAt ?? null)
        : patch.tokenExpiresAt,
  }
  return account
}

async function writeOfficialAccount(deps: IgDeps, patch: OfficialPatch): Promise<IgAccount> {
  const account = officialAccount(deps, await deps.store.getOfficialAccount(), patch)
  await deps.store.setOfficialAccount(account)
  return account
}

function accountPatchForError(err: unknown): OfficialPatch {
  if (err instanceof OfficialApiError) {
    if (err.kind === 'token_invalid')
      return { state: 'needs_login', message: TOKEN_REJECTED_MESSAGE }
    if (err.kind === 'permission') return { state: 'needs_login', message: PERMISSION_MESSAGE }
    if (err.kind === 'account_restricted') return { state: 'challenge', message: err.message }
    return { state: 'unknown', message: err.message }
  }
  return { state: 'unknown', message: 'Could not check the account. Try again.' }
}

/** Validates a pasted access token with `/me` and saves it encrypted; a rejected token is never saved. */
export async function connectOfficialAccount(
  deps: IgDeps,
  accessToken: string,
): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-official-connect' })
  try {
    const me = await deps.official.getAccount(accessToken)
    const now = clock(deps)
    const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString()
    await saveToken(deps, {
      accessToken,
      userId: me.userId,
      username: me.username,
      savedAt: now.toISOString(),
      refreshedAt: null,
      expiresAt,
      expiryKnown: false,
      refreshAttemptAt: null,
      expiryAlertAt: null,
    })
    log.info({ userId: me.userId, username: me.username }, 'instagram access token saved')
    return writeOfficialAccount(deps, {
      state: 'connected',
      message: null,
      username: me.username,
      tokenExpiresAt: expiresAt,
    })
  } catch (err) {
    log.error(errorFields(err), 'instagram access token was not accepted')
    const patch = accountPatchForError(err)
    const previous = await deps.store.getOfficialAccount()
    // A working token stays in place when a replacement is rejected, so the record is not changed.
    if ((await loadOfficialToken(deps)) && previous?.state === 'connected')
      return officialAccount(deps, previous, patch)
    return writeOfficialAccount(deps, patch)
  }
}

export async function checkOfficialAccount(deps: IgDeps): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-official-status' })
  const token = await loadOfficialToken(deps)
  if (!token) {
    log.info('no instagram access token saved')
    return writeOfficialAccount(deps, {
      state: 'disconnected',
      message: NO_TOKEN_MESSAGE,
      tokenExpiresAt: null,
    })
  }
  try {
    const me = await deps.official.getAccount(token.accessToken)
    log.info({ userId: me.userId }, 'instagram access token checked')
    return writeOfficialAccount(deps, {
      state: 'connected',
      message: null,
      username: me.username,
      tokenExpiresAt: token.expiresAt,
    })
  } catch (err) {
    log.error(errorFields(err), 'instagram access token check failed')
    return writeOfficialAccount(deps, accountPatchForError(err))
  }
}

export async function disconnectOfficialAccount(deps: IgDeps): Promise<IgAccount> {
  await deps.store.clearOfficialToken()
  deps.log.info({ op: 'ig-official-disconnect' }, 'instagram access token removed')
  return writeOfficialAccount(deps, { state: 'disconnected', message: null, tokenExpiresAt: null })
}

export type RefreshOutcome = 'no_token' | 'not_due' | 'refreshed' | 'failed'

/**
 * Runs on the cron. A pasted token is refreshed once it is a day old (that also reveals its real
 * expiry), then every 7 days. A failed refresh, or a token within 7 days of expiry, raises an alert.
 */
export async function refreshOfficialToken(deps: IgDeps): Promise<RefreshOutcome> {
  const log = deps.log.child({ op: 'ig-official-refresh' })
  let token = await loadOfficialToken(deps)
  if (!token) return 'no_token'
  const now = clock(deps)
  const since = (iso: string | null) => (iso ? now.getTime() - Date.parse(iso) : Infinity)
  const age = since(token.refreshedAt ?? token.savedAt)
  const due =
    age >= TOKEN_MIN_REFRESH_AGE_MS &&
    (!token.expiryKnown || age >= TOKEN_REFRESH_AFTER_MS) &&
    since(token.refreshAttemptAt) >= TOKEN_REFRESH_RETRY_MS
  let outcome: RefreshOutcome = 'not_due'

  if (due) {
    try {
      const fresh = await deps.official.refreshToken(token.accessToken)
      token = {
        ...token,
        accessToken: fresh.accessToken,
        refreshedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + fresh.expiresInSeconds * 1000).toISOString(),
        expiryKnown: true,
        refreshAttemptAt: null,
        expiryAlertAt: null,
      }
      await saveToken(deps, token)
      const account = await deps.store.getOfficialAccount()
      if (account)
        await deps.store.setOfficialAccount({ ...account, tokenExpiresAt: token.expiresAt })
      log.info({ expiresAt: token.expiresAt }, 'instagram access token refreshed')
      outcome = 'refreshed'
    } catch (err) {
      log.error(errorFields(err), 'instagram access token refresh failed')
      token = { ...token, refreshAttemptAt: now.toISOString() }
      await saveToken(deps, token)
      const rejected = err instanceof OfficialApiError && err.kind === 'token_invalid'
      if (rejected) await writeOfficialAccount(deps, accountPatchForError(err))
      await deps.alert({
        key: 'instagram_token_refresh_failed',
        message: rejected
          ? 'Instagram rejected the access token during refresh. Paste a new token in admin.'
          : 'Instagram access token refresh failed. It is retried in 6 hours.',
        fields: { expiresAt: token.expiresAt, expiryKnown: token.expiryKnown },
      })
      outcome = 'failed'
    }
  }

  const left = Date.parse(token.expiresAt) - now.getTime()
  if (left < TOKEN_EXPIRY_WARNING_MS && since(token.expiryAlertAt) >= TOKEN_EXPIRY_ALERT_EVERY_MS) {
    await saveToken(deps, { ...token, expiryAlertAt: now.toISOString() })
    await deps.alert({
      key: 'instagram_token_expiring',
      message:
        left <= 0
          ? 'The Instagram access token has expired. Paste a new token in admin.'
          : 'The Instagram access token expires within 7 days and has not been refreshed. Paste a new token in admin.',
      fields: { expiresAt: token.expiresAt, daysLeft: Math.max(0, Math.floor(left / DAY_MS)) },
    })
  }
  return outcome
}

function mediaUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}`
}

// Instagram can drop the @ from captions it returns.
const normalizeCaption = (text: string | null) =>
  (text ?? '').replace(/@/g, '').replace(/\s+/g, ' ').trim()

type Located = { mediaPk: string; permalink: string; match: 'caption' | 'time' }

/**
 * Finds a reel that was published but never recorded: same caption, else (when allowed) the reel
 * published soonest after `since` that no other post has claimed.
 */
async function locatePublished(
  deps: IgDeps,
  token: StoredToken,
  input: { caption: string; since: Date; allowTimeMatch: boolean },
): Promise<Located | null> {
  const [media, exclude] = await Promise.all([
    deps.official.listMediaSince(token.accessToken, token.userId, input.since),
    deps.store.recentMediaPks(),
  ])
  const taken = new Set(exclude)
  const fresh = media
    .filter((m) => !taken.has(m.id) && (!m.timestamp || m.timestamp >= input.since))
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0))
  const wanted = normalizeCaption(input.caption)
  const byCaption = fresh.find((m) => normalizeCaption(m.caption) === wanted)
  const hit: OfficialMedia | undefined =
    byCaption ?? (input.allowTimeMatch ? fresh.find((m) => m.timestamp) : undefined)
  if (!hit) return null
  const permalink = hit.permalink ?? (await permalinkFor(deps, token, hit.id))
  return { mediaPk: hit.id, permalink, match: byCaption ? 'caption' : 'time' }
}

// A published reel is recorded even when its link cannot be read: the profile is the fallback.
async function permalinkFor(deps: IgDeps, token: StoredToken, mediaId: string): Promise<string> {
  for (let attempt = 1; attempt <= PERMALINK_TRIES; attempt++) {
    try {
      return await deps.official.getPermalink(token.accessToken, mediaId)
    } catch (err) {
      deps.log.warn({ mediaId, attempt, ...errorFields(err) }, 'instagram permalink read failed')
    }
  }
  return `https://www.instagram.com/${token.username}/reels/`
}

async function waitForContainer(
  deps: IgDeps,
  token: StoredToken,
  containerId: string,
  log: Logger,
): Promise<ContainerStatus> {
  const started = clock(deps).getTime()
  for (let polls = 1; ; polls++) {
    let status: ContainerStatus
    try {
      status = await deps.official.getContainerStatus(token.accessToken, containerId)
    } catch (err) {
      const retryable =
        err instanceof OfficialApiError && (err.kind === 'network' || err.kind === 'transient')
      if (!retryable) throw err
      status = { statusCode: 'IN_PROGRESS', status: null }
    }
    const waited = clock(deps).getTime() - started
    if (status.statusCode !== 'IN_PROGRESS') {
      log.info(
        { containerId, polls, waitedMs: waited, status: status.statusCode },
        'container ready',
      )
      return status
    }
    if (waited + CONTAINER_POLL_INTERVAL_MS > CONTAINER_POLL_BUDGET_MS) {
      log.warn({ containerId, polls, waitedMs: waited }, 'container still processing, giving up')
      return status
    }
    await sleep(deps, CONTAINER_POLL_INTERVAL_MS)
  }
}

async function recordLocated(
  deps: IgDeps,
  post: ClaimedPost,
  token: StoredToken,
  input: { since: Date; allowTimeMatch: boolean },
  log: Logger,
): Promise<boolean> {
  try {
    const found = await locatePublished(deps, token, { caption: post.caption, ...input })
    if (found) {
      await deps.store.markPosted(post.id, { mediaPk: found.mediaPk, permalink: found.permalink })
      log.info({ mediaPk: found.mediaPk, match: found.match }, 'published reel found and recorded')
      return true
    }
  } catch (err) {
    log.warn(errorFields(err), 'could not look up the published reel')
  }
  // Live but not located yet: the lost-post lookup keeps looking and blocks a second post.
  await deps.store.markFailed(post.id, INSTAGRAM_LOST_ERROR)
  return false
}

async function handlePostError(
  deps: IgDeps,
  post: ClaimedPost,
  err: unknown,
  log: Logger,
): Promise<void> {
  log.error(errorFields(err), 'official instagram post failed')
  if (!(err instanceof OfficialApiError)) {
    await deps.store.markFailed(post.id, err instanceof Error ? err.message : 'post failed')
    return
  }
  switch (err.kind) {
    case 'token_invalid':
    case 'permission':
    case 'account_restricted': {
      const patch = accountPatchForError(err)
      await deps.store.release(post.id, patch.message ?? err.message)
      await writeOfficialAccount(deps, patch)
      return
    }
    case 'rate_limited':
      await deps.store.release(post.id, `Instagram rate limit: ${err.message} It will retry.`)
      return
    case 'not_ready':
      await deps.store.release(post.id, STILL_PROCESSING_NOTE)
      return
    case 'container_gone':
      await deps.store.setContainerId(post.id, null)
      await deps.store.release(post.id, 'Instagram dropped the upload. It starts again next run.')
      return
    case 'network':
    case 'transient':
      if (post.attempts >= MAX_TRANSIENT_ATTEMPTS) await deps.store.markFailed(post.id, err.message)
      else await deps.store.release(post.id, err.message)
      return
    default:
      await deps.store.setContainerId(post.id, null)
      await deps.store.markFailed(post.id, err.message)
  }
}

async function limitReached(deps: IgDeps, token: StoredToken, log: Logger): Promise<string | null> {
  try {
    const limit = await deps.official.getPublishingLimit(token.accessToken, token.userId)
    log.info(limit, 'instagram publishing limit read')
    if (limit.total !== null && limit.used >= limit.total)
      return `Instagram's posting limit is reached (${limit.used} of ${limit.total} in 24 hours). It will retry.`
    return null
  } catch (err) {
    if (err instanceof OfficialApiError && err.kind !== 'network' && err.kind !== 'transient')
      throw err
    log.warn(errorFields(err), 'publishing limit unreadable, posting anyway')
    return null
  }
}

/**
 * Create container, wait for Instagram to process it, publish. The container id is saved on the
 * post row before anything else, and a container can be published only once, so a rerun resumes
 * the same container instead of uploading the reel again.
 */
export async function runOfficialPost(
  deps: IgDeps,
  post: ClaimedPost,
  token: StoredToken,
): Promise<boolean> {
  const log = deps.log.child({ postId: post.id, itemId: post.item_id, publisher: 'official' })
  try {
    let containerId = await deps.store.getContainerId(post.id)
    let status: ContainerStatus | null = null
    for (let round = 0; round < 2; round++) {
      if (!containerId) {
        const blocked = await limitReached(deps, token, log)
        if (blocked) {
          await deps.store.release(post.id, blocked)
          return false
        }
        const posterKey = posterKeyForVideoKey(post.video_key)
        if (!posterKey)
          log.warn({ videoKey: post.video_key }, 'no poster key for video, cover is a frame')
        containerId = await deps.official.createReelContainer(token.accessToken, token.userId, {
          videoUrl: mediaUrl(deps.mediaBaseUrl, post.video_key),
          coverUrl: posterKey ? mediaUrl(deps.mediaBaseUrl, posterKey) : null,
          caption: post.caption,
          aiGenerated: await deps.aiLabel(),
        })
        await deps.store.setContainerId(post.id, containerId)
        log.info({ containerId }, 'instagram container created')
      } else {
        log.info({ containerId }, 'resuming instagram container')
      }
      status = await waitForContainer(deps, token, containerId, log)
      if (status.statusCode !== 'EXPIRED' || round > 0) break
      log.warn({ containerId }, 'instagram container expired, creating a new one')
      await deps.store.setContainerId(post.id, null)
      containerId = null
    }
    if (!containerId || !status) throw new Error('no instagram container')

    if (status.statusCode === 'IN_PROGRESS') {
      await deps.store.release(post.id, STILL_PROCESSING_NOTE)
      return false
    }
    if (status.statusCode === 'ERROR' || status.statusCode === 'EXPIRED') {
      await deps.store.setContainerId(post.id, null)
      await deps.store.markFailed(
        post.id,
        `Instagram could not process the video (${status.status ?? status.statusCode}).`,
      )
      return false
    }
    if (status.statusCode === 'PUBLISHED') {
      log.warn({ containerId }, 'container already published, looking up the reel')
      const since = new Date(clock(deps).getTime() - PUBLISHED_LOOKBACK_MS)
      return recordLocated(deps, post, token, { since, allowTimeMatch: false }, log)
    }

    const publishStarted = clock(deps)
    let mediaId: string
    try {
      mediaId = await deps.official.publish(token.accessToken, token.userId, containerId)
    } catch (err) {
      // A failed publish call can still have published: the container says which it was.
      const after = await deps.official
        .getContainerStatus(token.accessToken, containerId)
        .catch(() => null)
      log.warn(
        { containerId, after: after?.statusCode ?? null, ...errorFields(err) },
        'instagram publish call failed',
      )
      if (after?.statusCode === 'PUBLISHED') {
        const since = new Date(publishStarted.getTime() - LOOKUP_SLACK_MS)
        return recordLocated(deps, post, token, { since, allowTimeMatch: true }, log)
      }
      const refused = err instanceof OfficialApiError && err.answered
      if (refused && after && after.statusCode !== 'IN_PROGRESS') throw err
      await deps.store.markFailed(post.id, INSTAGRAM_LOST_ERROR)
      return false
    }
    const permalink = await permalinkFor(deps, token, mediaId)
    await deps.store.markPosted(post.id, { mediaPk: mediaId, permalink })
    log.info({ mediaPk: mediaId, containerId }, 'instagram post published')
    return true
  } catch (err) {
    await handlePostError(deps, post, err, log)
    return false
  }
}

/**
 * Settles a post whose run died: published containers are matched to the live reel, anything else
 * was never published and is safe to queue again. A failed lookup leaves it for the next run.
 */
export async function recoverLostOfficialPost(
  deps: IgDeps,
  lost: LostPost,
  token: StoredToken,
): Promise<'found' | 'not_found' | 'unknown'> {
  const log = deps.log.child({ postId: lost.id, itemId: lost.item_id, op: 'ig-official-find' })
  try {
    const containerId = await deps.store.getContainerId(lost.id)
    const status = containerId
      ? await deps.official.getContainerStatus(token.accessToken, containerId)
      : null
    // A row without a container may be an upload from the unofficial publisher, so it is looked up too.
    if (!status || status.statusCode === 'PUBLISHED') {
      const since = new Date(lost.started_at.getTime() - LOOKUP_SLACK_MS)
      const found = await locatePublished(deps, token, {
        caption: lost.caption,
        since,
        allowTimeMatch: Boolean(status),
      })
      if (found) {
        await deps.store.markLostFound(lost.id, {
          mediaPk: found.mediaPk,
          permalink: found.permalink,
        })
        log.info({ mediaPk: found.mediaPk, match: found.match }, 'lost reel found live')
        return 'found'
      }
      if (status) {
        log.warn({ containerId }, 'container is published but the reel was not found yet')
        return 'unknown'
      }
    }
    await deps.store.markLostNotFound(lost.id)
    log.warn({ containerId, status: status?.statusCode ?? null }, 'lost reel was never published')
    return 'not_found'
  } catch (err) {
    log.warn(errorFields(err), 'lost reel lookup failed, will retry next run')
    return 'unknown'
  }
}

// At most one post per run, like the unofficial queue; the claim query enforces the gap.
export async function runOfficialQueue(deps: IgDeps): Promise<QueueOutcome> {
  const stuck = await deps.store.failStuck()
  if (stuck > 0) deps.log.warn({ stuck }, 'instagram posts lost mid-publish, will look them up')
  const token = await loadOfficialToken(deps)
  const account = await deps.store.getOfficialAccount()
  if (!token || (account && BLOCKED_STATES.includes(account.state))) {
    deps.log.info({ hasToken: Boolean(token), state: account?.state ?? null }, 'official not ready')
    return { ran: 'none', reason: 'not_connected' }
  }

  const lost = await deps.store.nextLost()
  if (lost) await recoverLostOfficialPost(deps, lost, token)

  const del = await deps.store.claimDelete()
  if (del) {
    deps.log.warn({ postId: del.id }, 'delete refused: not possible with the official api')
    await deps.store.restoreAfterDeleteFailure(del.id, OFFICIAL_DELETE_MESSAGE)
    return { ran: 'delete', postId: del.id, ok: false }
  }
  const post = await deps.store.claimPost()
  if (post) return { ran: 'post', postId: post.id, ok: await runOfficialPost(deps, post, token) }
  return { ran: 'none', reason: 'nothing_due' }
}
