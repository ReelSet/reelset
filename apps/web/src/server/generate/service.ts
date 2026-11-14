import {
  UserRole,
  countOpenReelRequests,
  countReelRequestsSince,
  createChargedReelRequest,
  createReelRequest,
  creditBalance,
  creditResetsAt,
  errorFields,
  getReelRequest,
  getSetting,
  listReelRequests,
  listUpgradeRequests,
  SETTINGS,
  settleReelRequests,
  type Database,
  type Logger,
  type ReelRequestRow,
  type ReelRequestVia,
  type UpgradeRequestRow,
} from '@reelset/core'
import { z } from 'zod'
import type { ApiError, CreditsDto, ReelRequestDto } from '@/lib/generate/types'
import { mediaBaseUrl } from '@/server/env'
import { buildCreditsDto, buildReelRequestDto } from './dto'
import { kickIngest } from './kick'
import { loadRequestContexts } from './queries'
import { validateUrls } from './urls'

export const MAX_OPEN_REQUESTS = 3
export const MAX_REQUESTS_PER_DAY = 20
const SETTLE_INTERVAL_MS = 30_000
const DAY_MS = 24 * 60 * 60 * 1000

export type Viewer = { id: string; email: string | null; isAdmin: boolean }

export async function resolveViewer(
  db: Database,
  user: { id: string; email: string | null },
): Promise<Viewer> {
  const row = await db
    .selectFrom('profile')
    .select('role')
    .where('id', '=', user.id)
    .executeTakeFirst()
  return { id: user.id, email: user.email, isAdmin: row?.role === UserRole.admin }
}

let lastSettleAt = 0

/** Request status follows the item; reads nudge it forward at most every 30 s per instance. */
export async function maybeSettle(db: Database, log: Logger, now = Date.now()): Promise<void> {
  if (now - lastSettleAt < SETTLE_INTERVAL_MS) return
  lastSettleAt = now
  try {
    await settleReelRequests(db, log)
  } catch (err) {
    log.warn(errorFields(err), 'opportunistic settle failed')
  }
}

export function resetSettleThrottle(): void {
  lastSettleAt = 0
}

export async function toRequestDtos(
  db: Database,
  rows: readonly ReelRequestRow[],
): Promise<ReelRequestDto[]> {
  if (rows.length === 0) return []
  const mediaBase = mediaBaseUrl()
  const contexts = await loadRequestContexts(db, rows)
  return rows.map((row) => {
    const ctx = contexts.get(row.id) ?? { item: null, render: null, events: [], aheadOfYou: null }
    return buildReelRequestDto(row, ctx, mediaBase)
  })
}

export async function toRequestDto(db: Database, row: ReelRequestRow): Promise<ReelRequestDto> {
  const [dto] = await toRequestDtos(db, [row])
  if (!dto) throw new Error('toRequestDto: no dto built')
  return dto
}

async function creditSettings(db: Database, log: Logger) {
  const [monthlyFree, cost] = await Promise.all([
    getSetting(db, SETTINGS.monthlyFreeCredits, log),
    getSetting(db, SETTINGS.reelCreditCost, log),
  ])
  return { monthlyFree, cost }
}

export async function getCredits(
  db: Database,
  user: Pick<Viewer, 'id' | 'isAdmin'>,
  log: Logger,
  now: Date = new Date(),
): Promise<CreditsDto> {
  const { monthlyFree, cost } = await creditSettings(db, log)
  const balance = user.isAdmin ? monthlyFree : await creditBalance(db, user.id, monthlyFree, now)
  return buildCreditsDto({
    monthlyFree,
    cost,
    balance,
    resetsAt: creditResetsAt(now),
    unlimited: user.isAdmin,
  })
}

export type GenerateFailure = {
  ok: false
  status: number
  error: ApiError['error']
  message: string
}
export type GenerateSuccess = { ok: true; request: ReelRequestDto; credits: CreditsDto }

export async function createGenerateRequest(
  db: Database,
  input: { user: Viewer; urls: unknown; via: ReelRequestVia },
  log: Logger,
): Promise<GenerateSuccess | GenerateFailure> {
  const { user } = input
  const l = log.child({ fn: 'createGenerateRequest', userId: user.id, via: input.via })
  const checked = validateUrls(input.urls)
  if (!checked.ok) {
    l.info({ message: checked.message }, 'generate rejected: invalid urls')
    return { ok: false, status: 400, error: 'invalid_urls', message: checked.message }
  }

  const now = new Date()
  const { monthlyFree, cost } = await creditSettings(db, l)
  if (!user.isAdmin) {
    const [open, today, balance] = await Promise.all([
      countOpenReelRequests(db, user.id),
      countReelRequestsSince(db, user.id, new Date(now.getTime() - DAY_MS)),
      creditBalance(db, user.id, monthlyFree, now),
    ])
    if (open >= MAX_OPEN_REQUESTS) {
      l.info({ open }, 'generate rejected: too many open')
      return {
        ok: false,
        status: 429,
        error: 'too_many_open',
        message: `You already have ${MAX_OPEN_REQUESTS} reels in progress. Wait for one to finish.`,
      }
    }
    if (today >= MAX_REQUESTS_PER_DAY) {
      l.info({ today }, 'generate rejected: daily limit')
      return {
        ok: false,
        status: 429,
        error: 'daily_limit',
        message: `Daily limit of ${MAX_REQUESTS_PER_DAY} requests reached. Try again tomorrow.`,
      }
    }
    if (balance < cost) return outOfCredits(l, balance, cost)
  }

  let row: ReelRequestRow
  if (user.isAdmin) {
    row = await createReelRequest(db, { userId: user.id, urls: checked.urls, via: input.via })
  } else {
    const created = await createChargedReelRequest(
      db,
      { userId: user.id, urls: checked.urls, via: input.via, cost, monthlyFree, now },
      l,
    )
    if (!created.ok) return outOfCredits(l, created.balance, cost)
    row = created.request
  }
  const rl = l.child({ requestId: row.id })
  rl.info({ urls: checked.urls.length }, 'reel request created')

  await kickIngest(rl)
  const [request, credits] = await Promise.all([
    toRequestDto(db, row),
    getCredits(db, user, rl, now),
  ])
  return { ok: true, request, credits }
}

function outOfCredits(log: Logger, balance: number, cost: number): GenerateFailure {
  log.info({ balance, cost }, 'generate rejected: out of credits')
  return {
    ok: false,
    status: 402,
    error: 'out_of_credits',
    message: `A reel costs ${cost} credits and you have ${balance} left this month. Request more credits or wait for the monthly reset.`,
  }
}

export async function listMyRequests(
  db: Database,
  userId: string,
  limit = 20,
  log?: Logger,
): Promise<ReelRequestDto[]> {
  if (log) await maybeSettle(db, log)
  return toRequestDtos(db, await listReelRequests(db, { userId, limit }))
}

export async function getRequestForViewer(
  db: Database,
  id: string,
  viewer: Pick<Viewer, 'id' | 'isAdmin'>,
  log?: Logger,
): Promise<ReelRequestDto | null> {
  if (!z.guid().safeParse(id).success) return null
  if (log) await maybeSettle(db, log)
  const row = await getReelRequest(db, id)
  if (!row || (row.user_id !== viewer.id && !viewer.isAdmin)) return null
  return toRequestDto(db, row)
}

export type AdminRequestRow = { dto: ReelRequestDto; userId: string; userLabel: string }

export async function listAllRequests(
  db: Database,
  opts: { limit: number; offset?: number },
  log?: Logger,
): Promise<AdminRequestRow[]> {
  if (log) await maybeSettle(db, log)
  const rows = await listReelRequests(db, opts)
  const dtos = await toRequestDtos(db, rows)
  const ids = [...new Set(rows.map((r) => r.user_id))]
  const profiles =
    ids.length > 0
      ? await db
          .selectFrom('profile')
          .select(['id', 'display_name'])
          .where('id', 'in', ids)
          .execute()
      : []
  const names = new Map(profiles.map((p) => [p.id, p.display_name]))
  return rows.map((row, i) => ({
    dto: dtos[i] as ReelRequestDto,
    userId: row.user_id,
    userLabel: names.get(row.user_id) ?? row.user_id.slice(0, 8),
  }))
}

export async function listOpenUpgradeRequests(
  db: Database,
  limit = 50,
): Promise<UpgradeRequestRow[]> {
  return listUpgradeRequests(db, { status: 'open', limit })
}

export async function monthlyUsage(
  db: Database,
  userId: string,
  log: Logger,
  now: Date = new Date(),
): Promise<{ used: number; monthlyFree: number }> {
  const { monthlyFree } = await creditSettings(db, log)
  const balance = await creditBalance(db, userId, monthlyFree, now)
  return { used: Math.max(0, monthlyFree - balance), monthlyFree }
}
