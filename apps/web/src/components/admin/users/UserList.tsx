import { fmtDate } from '@/lib/admin/format'
import { relativeTime } from '@/lib/admin/pipeline'
import { providerLabel, userDisplay } from '@/lib/admin/users'
import { UserLink } from '@/components/admin/drawer/DrawerLink'
import { SortTh, type SortCtx } from '@/components/admin/sortable'
import { Table, td, th } from '@/components/admin/ui'
import type { UserSortKey } from '@/lib/admin/users'
import type { UserRow } from '@/server/admin/users'
import { UserIdentity } from './UserIdentity'

type Props = {
  rows: UserRow[]
  ctx: SortCtx<UserSortKey>
  tz: string
  now: Date
  userHref: (id: string) => string
}

function displayName(user: UserRow): string {
  return userDisplay({
    displayName: user.display_name,
    providerName: user.provider_name,
    handle: user.handle,
    email: user.email,
  }).name
}

function Counts({ user }: { user: UserRow }) {
  return (
    <span className="tabular-nums text-muted">
      {user.like_count} likes · {user.save_count} saves
    </span>
  )
}

function UpgradeFlag({ count }: { count: number }) {
  if (count === 0) return null
  return <span className="rounded-full bg-warn/20 px-1.5 text-[11px] text-warn">{count} open</span>
}

function UserTable({ rows, ctx, tz, now, userHref }: Props) {
  return (
    <div className="hidden md:block">
      <Table>
        <thead>
          <tr>
            <th className={th}>User</th>
            <th className={th}>Provider</th>
            <SortTh ctx={ctx} col="joined" />
            <SortTh ctx={ctx} col="active" />
            <SortTh ctx={ctx} col="reels" />
            <th className={th}>Credits used</th>
            <th className={th}>Activity</th>
            <th className={th}>Upgrade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td className={`${td} max-w-[22rem]`}>
                <UserLink
                  id={u.id}
                  name={displayName(u)}
                  href={userHref(u.id)}
                  className="block hover:opacity-80"
                >
                  <UserIdentity user={u} />
                </UserLink>
              </td>
              <td className={td}>{providerLabel(u.provider)}</td>
              <td className={`${td} whitespace-nowrap`}>{fmtDate(u.created_at, tz)}</td>
              <td className={`${td} whitespace-nowrap`} title={fmtDate(u.last_active_at, tz)}>
                {relativeTime(u.last_active_at, now)}
              </td>
              <td className={`${td} tabular-nums`}>{u.reel_count}</td>
              <td className={`${td} tabular-nums`}>{u.credits_used}</td>
              <td className={`${td} whitespace-nowrap`}>
                <Counts user={u} />
              </td>
              <td className={td}>
                <UpgradeFlag count={u.open_upgrades} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

function UserCards({ rows, tz, now, userHref }: Omit<Props, 'ctx'>) {
  return (
    <ul className="space-y-2 md:hidden">
      {rows.map((u) => (
        <li key={u.id}>
          <UserLink
            id={u.id}
            name={displayName(u)}
            href={userHref(u.id)}
            className="block rounded-md border border-line bg-surface p-3 transition hover:bg-raised/60"
          >
            <UserIdentity user={u} />
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-faint">Provider</dt>
              <dd className="text-right">{providerLabel(u.provider)}</dd>
              <dt className="text-faint">Joined</dt>
              <dd className="text-right">{fmtDate(u.created_at, tz)}</dd>
              <dt className="text-faint">Last active</dt>
              <dd className="text-right">{relativeTime(u.last_active_at, now)}</dd>
              <dt className="text-faint">Reels</dt>
              <dd className="text-right tabular-nums">{u.reel_count}</dd>
              <dt className="text-faint">Credits used</dt>
              <dd className="text-right tabular-nums">{u.credits_used}</dd>
              <dt className="text-faint">Activity</dt>
              <dd className="text-right">
                <Counts user={u} />
              </dd>
            </dl>
            {u.open_upgrades > 0 && (
              <p className="mt-2 text-right">
                <UpgradeFlag count={u.open_upgrades} />
              </p>
            )}
          </UserLink>
        </li>
      ))}
    </ul>
  )
}

/** Table on desktop, stacked cards on mobile; every row opens the user drawer. */
export function UserList(props: Props) {
  return (
    <>
      <UserTable {...props} />
      <UserCards rows={props.rows} tz={props.tz} now={props.now} userHref={props.userHref} />
    </>
  )
}
