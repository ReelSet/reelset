import { creditMonth, grantCredits, type Database, type Logger } from '@reelset/core'
import { sql, type RawBuilder } from 'kysely'
import { sliceWithMore, type PageRequest } from '@/lib/admin/pagination'
import type { SortState } from '@/lib/admin/sort'
import { creditsUsedFrom, ilikePattern, type UserSortKey } from '@/lib/admin/users'
import type { CommandResult } from '@/server/admin/commands'
import { grantSchema, GRANT_MAX } from '@/server/admin/generate'

const ACTIVE_WINDOW_DAYS = 7
const DETAIL_REQUEST_LIMIT = 10
const DETAIL_LEDGER_LIMIT = 50
const DETAIL_UPGRADE_LIMIT = 10
const SINGLE_ROW: PageRequest = { page: 1, pageSize: 1, offset: 0 }
const DETAIL_SORT: SortState<UserSortKey> = { key: 'joined', dir: 'desc' }

// Whitelisted ORDER BY expressions; the sort key from the URL only ever selects one of these.
const USER_SORT: Record<UserSortKey, RawBuilder<unknown>> = {
  joined: sql`p.created_at`,
  active: sql`last_active_at`,
  reels: sql`reel_count`,
}

export type UserRow = {
  id: string
  email: string | null
  display_name: string | null
  provider_name: string | null
  handle: string | null
  provider_avatar: string | null
  avatar_hidden: boolean
  avatar_updated_at: Date | null
  role: string
  provider: string | null
  created_at: Date
  last_sign_in_at: Date | null
  last_active_at: Date | null
  reel_count: number
  credits_used: number
  like_count: number
  save_count: number
  open_upgrades: number
}

export type UserStats = { total: number; newInWindow: number; activeInWindow: number }

export type UserFilters = { search: string | null; userId?: string }

type RawUserRow = Omit<UserRow, 'credits_used'> & { month_delta: string }

function filterClause({ search, userId }: UserFilters): RawBuilder<unknown> {
  if (userId) return sql`p.id = ${userId}::uuid`
  if (!search) return sql`true`
  const pattern = ilikePattern(search)
  return sql`(
    u.email ilike ${pattern}
    or p.display_name ilike ${pattern}
    or u.raw_user_meta_data->>'full_name' ilike ${pattern}
    or u.raw_user_meta_data->>'user_name' ilike ${pattern}
  )`
}

/** One page of users with per-user aggregates; emails come from auth.users via the privileged connection. */
export async function listUsers(
  db: Database,
  page: PageRequest,
  filters: UserFilters,
  sort: SortState<UserSortKey>,
  now: Date = new Date(),
): Promise<{ rows: UserRow[]; hasMore: boolean }> {
  const direction = sort.dir === 'asc' ? sql`asc` : sql`desc`
  const result = await sql<RawUserRow>`
    select
      p.id, p.display_name, p.role, p.avatar_hidden, p.created_at,
      u.email, u.last_sign_in_at,
      u.raw_app_meta_data->>'provider' as provider,
      coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') as provider_name,
      u.raw_user_meta_data->>'user_name' as handle,
      coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') as provider_avatar,
      av.updated_at as avatar_updated_at,
      ev.last_event_at,
      greatest(u.last_sign_in_at, ev.last_event_at) as last_active_at,
      rr.reel_count, cl.month_delta, lk.like_count, sv.save_count, up.open_upgrades
    from profile p
    join auth.users u on u.id = p.id
    left join profile_avatar av on av.profile_id = p.id
    left join lateral (
      select max(created_at) as last_event_at from event where profile_id = p.id
    ) ev on true
    left join lateral (
      select count(*)::int as reel_count from reel_request where user_id = p.id
    ) rr on true
    left join lateral (
      select coalesce(sum(delta), 0) as month_delta from credit_ledger
      where user_id = p.id and month = ${creditMonth(now)} and reason <> 'grant'
    ) cl on true
    left join lateral (
      select count(*)::int as like_count from "like" where profile_id = p.id
    ) lk on true
    left join lateral (
      select count(*)::int as save_count from save where profile_id = p.id
    ) sv on true
    left join lateral (
      select count(*)::int as open_upgrades from credit_upgrade_request
      where user_id = p.id and status = 'open'
    ) up on true
    where ${filterClause(filters)}
    order by ${USER_SORT[sort.key]} ${direction} nulls last, p.id
    limit ${page.pageSize + 1} offset ${page.offset}
  `.execute(db)
  const rows = result.rows.map(({ month_delta, ...row }) => ({
    ...row,
    credits_used: creditsUsedFrom(Number(month_delta)),
  }))
  return sliceWithMore(rows, page.pageSize)
}

/** Header numbers; "active" counts distinct signed-in users with an event in the window. */
export async function userStats(db: Database, now: Date = new Date()): Promise<UserStats> {
  const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000)
  const { rows } = await sql<{ total: string; new_in_window: string; active_in_window: string }>`
    select
      (select count(*) from profile) as total,
      (select count(*) from profile where created_at >= ${since}) as new_in_window,
      (select count(distinct profile_id) from event
        where profile_id is not null and created_at >= ${since}) as active_in_window
  `.execute(db)
  const row = rows[0]
  return {
    total: Number(row?.total ?? 0),
    newInWindow: Number(row?.new_in_window ?? 0),
    activeInWindow: Number(row?.active_in_window ?? 0),
  }
}

export type UserDetail = {
  user: UserRow
  requests: {
    id: string
    status: string
    urls: string[]
    item_id: string | null
    credits_charged: number
    refunded: boolean
    via: string
    error: string | null
    created_at: Date
  }[]
  ledger: { id: string; delta: number; reason: string; created_at: Date }[]
  upgrades: {
    id: string
    status: string
    message: string | null
    credits_granted: number | null
    created_at: Date
  }[]
  month: string
}

/** Everything the drawer shows for one user; null when the id is not a profile. */
export async function userDetail(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<UserDetail | null> {
  const month = creditMonth(now)
  const [users, requests, ledger, upgrades] = await Promise.all([
    listUsers(db, SINGLE_ROW, { search: null, userId }, DETAIL_SORT, now),
    db
      .selectFrom('reel_request')
      .select([
        'id',
        'status',
        'urls',
        'item_id',
        'credits_charged',
        'refunded',
        'via',
        'error',
        'created_at',
      ])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(DETAIL_REQUEST_LIMIT)
      .execute(),
    db
      .selectFrom('credit_ledger')
      .select(['id', 'delta', 'reason', 'created_at'])
      .where('user_id', '=', userId)
      .where('month', '=', month)
      .orderBy('created_at', 'desc')
      .limit(DETAIL_LEDGER_LIMIT)
      .execute(),
    db
      .selectFrom('credit_upgrade_request')
      .select(['id', 'status', 'message', 'credits_granted', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(DETAIL_UPGRADE_LIMIT)
      .execute(),
  ])
  const user = users.rows[0]
  return user ? { user, requests, ledger, upgrades, month } : null
}

export async function grantUserCredits(
  db: Database,
  input: { userId: string; credits: unknown },
  log: Logger,
): Promise<CommandResult> {
  const credits = grantSchema.safeParse(input.credits)
  if (!credits.success) return { ok: false, message: `Credits must be 1-${GRANT_MAX}` }
  const exists = await db
    .selectFrom('profile')
    .select('id')
    .where('id', '=', input.userId)
    .executeTakeFirst()
  if (!exists) return { ok: false, message: 'User not found' }
  await grantCredits(db, { userId: input.userId, credits: credits.data }, log)
  return { ok: true, message: `Granted ${credits.data} credits` }
}
