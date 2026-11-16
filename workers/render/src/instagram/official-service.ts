import {
  INSTAGRAM_LOST_ERROR,
  errorFields,
  type IgAccount,
  type IgAccountState,
  type Logger,
} from '@reelset/core'
import { posterKeyForVideoKey } from '../keys'
import { decryptJson, encryptJson } from './crypto'
import {
  OfficialApiError,
  type ContainerStatus,
  type OfficialAccount,
  type OfficialMedia,
} from './official-client'
import type { IgDeps, QueueOutcome } from './service'
import type { ClaimedPost, LostPost } from './store'

const DAY_MS = 86_400_000
// With the Meta app id and secret the token is inspected once a day (expiry, validity, scopes) and,
// if it expires at all, replaced this long before it does. Without them it is only health-checked.
export const TOKEN_CHECK_EVERY_MS = DAY_MS
export const TOKEN_REFRESH_BEFORE_MS = 14 * DAY_MS
export const TOKEN_EXPIRY_WARNING_MS = 7 * DAY_MS
export const TOKEN_EXPIRY_ALERT_EVERY_MS = DAY_MS

// Meta recommends checking a container about once a minute for at most 5 minutes.
export const CONTAINER_POLL_INTERVAL_MS = 30_000
export const CONTAINER_POLL_BUDGET_MS = 5 * 60_000
export const MAX_TRANSIENT_ATTEMPTS = 6
const PERMALINK_TRIES = 3
const PUBLISHED_LOOKBACK_MS = DAY_MS
const LOOKUP_SLACK_MS = 2 * 60_000

const PUBLISH_SCOPE = 'instagram_content_publish'
const TOKEN_MANAGEMENT_SCOPE = 'business_management'
export const UNOFFICIAL_DELETE_MESSAGE =
  'This reel was posted by the unofficial publisher, so the official API cannot delete it. Delete it in the Instagram app, or set instagram_publisher to unofficial and delete it again.'
const DELETE_REFUSED_ADVICE =
  "Meta documents delete for the Facebook Login setup only; it may work once instagram_manage_contents is added to the app's configuration. Otherwise delete the reel in the Instagram app."
const NO_TOKEN_MESSAGE = 'No access token saved. Paste one to connect.'
const TOKEN_REJECTED_MESSAGE =
  'Meta rejected the access token (invalid, expired or removed). Generate a new one and paste it.'
const PERMISSION_MESSAGE =
  'The access token is missing a permission. It needs instagram_basic and instagram_content_publish.'
const NO_ACCOUNT_MESSAGE =
  'This token has no Instagram account assigned. In the Meta app dashboard, add the account under "Generate access tokens" and generate the token for it.'
const ACCOUNT_GONE_MESSAGE =
  'The Instagram account is no longer shared with this token. Generate a new token and paste it.'
const EXPIRY_UNKNOWN_NOTE = 'Expiry date unknown: add META_APP_ID and META_APP_SECRET to see it.'
const NEVER_EXPIRES_NOTE = 'This token does not expire.'
const STILL_PROCESSING_NOTE =
  'Instagram is still processing the video. Publishing continues on the next run.'
const BLOCKED_STATES: readonly IgAccountState[] = ['needs_login', 'challenge', 'disconnected']

export type StoredToken = {
  accessToken: string
  /** The Instagram account id used in request paths. */
  userId: string
  username: string
  /** Needed by the token management API; null when Meta did not return one. */
  clientBusinessId: string | null
  savedAt: string
  refreshedAt: string | null
  /** Null with `expiryKnown` true means the token never expires. */
  expiresAt: string | null
  expiryKnown: boolean
  scopes: string[] | null
  checkedAt: string | null
  refreshAttemptAt: string | null
  expiryAlertAt: string | null
}

const clock = (deps: IgDeps) => deps.now?.() ?? new Date()
const sleep = (deps: IgDeps, ms: number) =>
  deps.sleep ? deps.sleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms))
const text = (v: unknown) => (typeof v === 'string' ? v : null)

export async function loadOfficialToken(deps: IgDeps): Promise<StoredToken | null> {
  const blob = await deps.store.getOfficialToken()
  if (!blob) return null
  try {
    const v = (await decryptJson(deps.key, blob)) as Partial<StoredToken> | null
    if (
      typeof v?.accessToken !== 'string' ||
      typeof v.userId !== 'string' ||
      typeof v.username !== 'string' ||
      typeof v.savedAt !== 'string'
    )
      return null
    return {
      accessToken: v.accessToken,
      userId: v.userId,
      username: v.username,
      clientBusinessId: text(v.clientBusinessId),
      savedAt: v.savedAt,
      refreshedAt: text(v.refreshedAt),
      expiresAt: text(v.expiresAt),
      expiryKnown: v.expiryKnown === true,
      scopes: Array.isArray(v.scopes) ? v.scopes.filter((x) => typeof x === 'string') : null,
      checkedAt: text(v.checkedAt),
      refreshAttemptAt: text(v.refreshAttemptAt),
      expiryAlertAt: text(v.expiryAlertAt),
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
    ...(previous?.insightsPermission === undefined
      ? {}
      : { insightsPermission: previous.insightsPermission }),
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

/** A token problem the admin has to fix, said in plain words. */
class TokenProblem extends Error {}

function accountPatchForError(err: unknown): OfficialPatch {
  if (err instanceof TokenProblem) return { state: 'needs_login', message: err.message }
  if (err instanceof OfficialApiError) {
    if (err.kind === 'token_invalid')
      return { state: 'needs_login', message: TOKEN_REJECTED_MESSAGE }
    if (err.kind === 'permission') return { state: 'needs_login', message: PERMISSION_MESSAGE }
    if (err.kind === 'account_restricted') return { state: 'challenge', message: err.message }
    return { state: 'unknown', message: err.message }
  }
  return { state: 'unknown', message: 'Could not check the account. Try again.' }
}

const handle = (name: string) => name.trim().replace(/^@/, '').toLowerCase()

// One token can cover several Instagram accounts; IG_USERNAME says which one this app posts to.
function pickAccount(deps: IgDeps, accounts: OfficialAccount[]): OfficialAccount {
  if (accounts.length === 0) throw new TokenProblem(NO_ACCOUNT_MESSAGE)
  if (accounts.length === 1) return accounts[0]!
  const wanted = deps.preferredUsername ? handle(deps.preferredUsername) : null
  const match = wanted ? accounts.find((a) => handle(a.username) === wanted) : undefined
  if (match) return match
  const names = accounts.map((a) => `@${a.username}`).join(', ')
  throw new TokenProblem(
    wanted
      ? `This token covers ${names}, but not @${wanted} (IG_USERNAME). Generate a token for that account.`
      : `This token covers several Instagram accounts (${names}). Set the IG_USERNAME worker secret to the one to post to, then paste the token again.`,
  )
}

type Expiry = Pick<StoredToken, 'expiresAt' | 'expiryKnown' | 'scopes'>

// Reads expiry and scopes with debug_token; without the Meta app secrets both stay unknown.
async function inspect(deps: IgDeps, accessToken: string): Promise<Expiry> {
  if (!deps.official.canManageTokens) return { expiresAt: null, expiryKnown: false, scopes: null }
  const info = await deps.official.inspectToken(accessToken)
  if (!info.valid) throw new TokenProblem(TOKEN_REJECTED_MESSAGE)
  if (!info.scopes.includes(PUBLISH_SCOPE)) throw new TokenProblem(PERMISSION_MESSAGE)
  return {
    expiresAt: info.expiresAt ? info.expiresAt.toISOString() : null,
    expiryKnown: true,
    scopes: info.scopes,
  }
}

const expiryNote = (token: Expiry) =>
  !token.expiryKnown ? EXPIRY_UNKNOWN_NOTE : token.expiresAt ? null : NEVER_EXPIRES_NOTE

/**
 * Validates a pasted token by listing the Instagram accounts it covers and saves it encrypted with
 * the account id and the client business id; a token that fails any check is never saved.
 */
export async function connectOfficialAccount(
  deps: IgDeps,
  accessToken: string,
): Promise<IgAccount> {
  const log = deps.log.child({ op: 'ig-official-connect' })
  try {
    const account = pickAccount(deps, await deps.official.listAccounts(accessToken))
    const expiry = await inspect(deps, accessToken)
    const clientBusinessId = await deps.official.getClientBusinessId(accessToken).catch((err) => {
      log.warn(errorFields(err), 'client business id unreadable, token refresh will be skipped')
      return null
    })
    const now = clock(deps).toISOString()
    await saveToken(deps, {
      accessToken,
      userId: account.userId,
      username: account.username,
      clientBusinessId,
      savedAt: now,
      refreshedAt: null,
      ...expiry,
      checkedAt: now,
      refreshAttemptAt: null,
      expiryAlertAt: null,
    })
    log.info(
      {
        userId: account.userId,
        username: account.username,
        hasBusinessId: Boolean(clientBusinessId),
        expiresAt: expiry.expiresAt,
        expiryKnown: expiry.expiryKnown,
      },
      'instagram access token saved',
    )
    return writeOfficialAccount(deps, {
      state: 'connected',
      message: expiryNote(expiry),
      username: account.username,
      tokenExpiresAt: expiry.expiresAt,
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
    const accounts = await deps.official.listAccounts(token.accessToken)
    const account = accounts.find((a) => a.userId === token.userId)
    if (!account) throw new TokenProblem(ACCOUNT_GONE_MESSAGE)
    log.info({ userId: account.userId }, 'instagram access token checked')
    return writeOfficialAccount(deps, {
      state: 'connected',
      message: expiryNote(token),
      username: account.username,
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

export type RefreshOutcome = 'no_token' | 'not_due' | 'checked' | 'refreshed' | 'failed'

async function tokenStoppedWorking(deps: IgDeps, err: unknown): Promise<void> {
  await writeOfficialAccount(deps, accountPatchForError(err))
  await deps.alert({
    key: 'instagram_token_refresh_failed',
    message: 'The Instagram access token stopped working. Paste a new token in admin.',
  })
}

/**
 * Runs on the cron and does real work once a day. System user tokens never expire by default, so
 * for most tokens this only confirms the token still works. A token that does expire is replaced
 * through the token management API 14 days ahead, which needs the Meta app secret, the
 * business_management permission and the client business id; without any of those it alerts instead.
 */
export async function refreshOfficialToken(deps: IgDeps): Promise<RefreshOutcome> {
  const log = deps.log.child({ op: 'ig-official-refresh' })
  let token = await loadOfficialToken(deps)
  if (!token) return 'no_token'
  const now = clock(deps)
  const since = (iso: string | null) => (iso ? now.getTime() - Date.parse(iso) : Infinity)
  if (since(token.checkedAt) < TOKEN_CHECK_EVERY_MS) return 'not_due'
  let outcome: RefreshOutcome = 'checked'

  try {
    if (deps.official.canManageTokens) {
      token = { ...token, ...(await inspect(deps, token.accessToken)) }
    } else {
      const accounts = await deps.official.listAccounts(token.accessToken)
      if (!accounts.some((a) => a.userId === token!.userId))
        throw new TokenProblem(ACCOUNT_GONE_MESSAGE)
    }
  } catch (err) {
    log.error(errorFields(err), 'daily instagram access token check failed')
    const dead =
      err instanceof TokenProblem ||
      (err instanceof OfficialApiError && err.kind === 'token_invalid')
    // A check that could not run is tried again on the next tick; a dead token waits for a new one.
    if (!dead) return 'failed'
    await saveToken(deps, { ...token, checkedAt: now.toISOString() })
    await tokenStoppedWorking(deps, err)
    return 'failed'
  }
  token = { ...token, checkedAt: now.toISOString() }

  const left = () => (token!.expiresAt ? Date.parse(token!.expiresAt) - now.getTime() : Infinity)
  const cannotRefresh = !deps.official.canManageTokens
    ? 'META_APP_ID and META_APP_SECRET are not set'
    : !token.clientBusinessId
      ? 'the client business id is unknown'
      : !token.scopes?.includes(TOKEN_MANAGEMENT_SCOPE)
        ? `the token lacks the ${TOKEN_MANAGEMENT_SCOPE} permission`
        : null

  if (left() < TOKEN_REFRESH_BEFORE_MS && !cannotRefresh) {
    try {
      const fresh = await deps.official.refreshToken(token.accessToken, token.clientBusinessId!)
      const expiry = await inspect(deps, fresh)
      token = {
        ...token,
        ...expiry,
        accessToken: fresh,
        refreshedAt: now.toISOString(),
        refreshAttemptAt: null,
        expiryAlertAt: null,
      }
      log.info({ expiresAt: token.expiresAt }, 'instagram access token replaced')
      outcome = 'refreshed'
    } catch (err) {
      log.error(errorFields(err), 'instagram access token refresh failed')
      // Retried on the next daily check at the earliest.
      token = { ...token, refreshAttemptAt: now.toISOString() }
      await deps.alert({
        key: 'instagram_token_refresh_failed',
        message: 'Instagram access token refresh failed. It is retried tomorrow.',
        fields: { expiresAt: token.expiresAt },
      })
      outcome = 'failed'
    }
  }

  if (
    left() < TOKEN_EXPIRY_WARNING_MS &&
    since(token.expiryAlertAt) >= TOKEN_EXPIRY_ALERT_EVERY_MS
  ) {
    token = { ...token, expiryAlertAt: now.toISOString() }
    await deps.alert({
      key: 'instagram_token_expiring',
      message:
        left() <= 0
          ? 'The Instagram access token has expired. Paste a new token in admin.'
          : `The Instagram access token expires within 7 days${cannotRefresh ? ` and cannot be refreshed automatically (${cannotRefresh})` : ' and the refresh has not worked'}. Paste a new token in admin.`,
      fields: { expiresAt: token.expiresAt, daysLeft: Math.max(0, Math.floor(left() / DAY_MS)) },
    })
  }

  await saveToken(deps, token)
  const account = await deps.store.getOfficialAccount()
  if (account && account.state === 'connected')
    await deps.store.setOfficialAccount({
      ...account,
      message: expiryNote(token),
      tokenExpiresAt: token.expiresAt,
    })
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

/**
 * Tries the delete and reports Meta's own reason when it is refused. Only reels this publisher
 * posted are tried: the unofficial publisher stores a different kind of media id.
 */
export async function runOfficialDelete(
  deps: IgDeps,
  post: ClaimedPost,
  token: StoredToken,
): Promise<boolean> {
  const log = deps.log.child({ postId: post.id, mediaPk: post.media_pk, publisher: 'official' })
  if (!post.media_pk || !(await deps.store.getContainerId(post.id))) {
    log.warn('delete refused: the reel was not posted by the official publisher')
    await deps.store.restoreAfterDeleteFailure(post.id, UNOFFICIAL_DELETE_MESSAGE)
    return false
  }
  try {
    if (!(await deps.official.deleteMedia(token.accessToken, post.media_pk)))
      throw new Error('Instagram did not confirm the delete')
    await deps.store.markDeleted(post.id)
    log.info('instagram post deleted')
    return true
  } catch (err) {
    log.error(errorFields(err), 'official instagram delete failed')
    const refused = err instanceof OfficialApiError && err.answered
    await deps.store.restoreAfterDeleteFailure(
      post.id,
      refused
        ? `Instagram refused the delete: ${err.message} ${DELETE_REFUSED_ADVICE}`
        : err instanceof Error
          ? err.message
          : 'delete failed',
    )
    if (err instanceof OfficialApiError && err.kind === 'token_invalid')
      await writeOfficialAccount(deps, accountPatchForError(err))
    return false
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
  if (del) return { ran: 'delete', postId: del.id, ok: await runOfficialDelete(deps, del, token) }
  const post = await deps.store.claimPost()
  if (post) return { ran: 'post', postId: post.id, ok: await runOfficialPost(deps, post, token) }
  return { ran: 'none', reason: 'nothing_due' }
}
