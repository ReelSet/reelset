import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { parseSort } from '@/lib/admin/sort'
import {
  DEFAULT_USER_SORT,
  USER_PAGE_SIZE,
  USER_SORT_KEYS,
  parseUserSearch,
  type UserSortKey,
} from '@/lib/admin/users'
import { zoneHint } from '@/lib/time/zone'
import { Flash, Empty, Pager, Section, Stat, Toolbar, button, input } from '@/components/admin/ui'
import { SortBar, sortQuery, type SortColumn, type SortCtx } from '@/components/admin/sortable'
import { UserList } from '@/components/admin/users/UserList'
import { assertAdmin } from '@/server/admin/guard'
import { listUsers, userStats } from '@/server/admin/users'
import { getDb } from '@/server/db'
import { viewerTimeZone } from '@/server/timezone'

export const metadata = { title: 'Users' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const COLUMNS: SortColumn<UserSortKey>[] = [
  { key: 'joined', label: 'Joined' },
  { key: 'active', label: 'Last active' },
  { key: 'reels', label: 'Reels' },
]

export default async function UsersPage({ searchParams }: Props) {
  await assertAdmin()
  const [tz, sp] = await Promise.all([viewerTimeZone(), searchParams])
  const now = new Date()
  const db = getDb()
  const page = parsePage(sp.page, USER_PAGE_SIZE)
  const search = parseUserSearch(sp.q)
  const sort = parseSort(sp, USER_SORT_KEYS, DEFAULT_USER_SORT)

  const [stats, users] = await Promise.all([
    userStats(db, now),
    listUsers(db, page, { search }, sort, now),
  ])

  const ctx: SortCtx<UserSortKey> = {
    path: ADMIN_ROUTES.users,
    params: { q: search ?? undefined },
    sort,
    fallback: DEFAULT_USER_SORT,
    columns: COLUMNS,
  }
  const params = { ...ctx.params, ...sortQuery(ctx) }
  const userHref = (id: string) => pageHref(ADMIN_ROUTES.users, { ...params, user: id }, page.page)

  return (
    <div>
      <Flash value={sp.flash} />
      <Toolbar hint={`Everyone who has signed up. Select a user for details. ${zoneHint(tz)}`} />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Total users" value={stats.total.toLocaleString('en-US')} />
        <Stat label="New, 7 days" value={stats.newInWindow.toLocaleString('en-US')} />
        <Stat label="Active, 7 days" value={stats.activeInWindow.toLocaleString('en-US')} />
      </div>
      <Section title="Users">
        <form method="get" action={ADMIN_ROUTES.users} className="mb-3 flex gap-2">
          {Object.entries(sortQuery(ctx)).map(([name, value]) =>
            value ? <input key={name} type="hidden" name={name} value={value} /> : null,
          )}
          <input
            name="q"
            defaultValue={search ?? ''}
            placeholder="Search email, name or username"
            aria-label="Search users"
            maxLength={80}
            className={`${input} min-w-0 flex-1 sm:max-w-sm`}
          />
          <button type="submit" className={button}>
            Search
          </button>
        </form>
        {users.rows.length === 0 ? (
          <Empty>{search ? 'No users match that search' : 'No users yet'}</Empty>
        ) : (
          <>
            <div className="mb-3 md:hidden">
              <SortBar ctx={ctx} />
            </div>
            <UserList rows={users.rows} ctx={ctx} tz={tz} now={now} userHref={userHref} />
          </>
        )}
        <Pager path={ADMIN_ROUTES.users} params={params} page={page.page} hasMore={users.hasMore} />
      </Section>
    </div>
  )
}
