'use client'

import Link from 'next/link'
import { fmtDate, truncate } from '@/lib/admin/format'
import type { UserDrawerData, UserPreview } from '@/lib/admin/drawer-types'
import { providerLabel } from '@/lib/admin/user-display'
import { Block, DrawerError, KV } from '@/components/admin/drawer/blocks'
import type { DetailError } from '@/components/admin/drawer/detail-store'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { Status, button, input } from '@/components/admin/primitives'
import { useTimeZone } from '@/components/ui/TimeZoneContext'
import { grantCreditsAction } from '@/app/admin/(overview)/users/actions'
import { UserDrawerSkeleton } from './UserDrawerSkeleton'
import { UserIdentity } from './UserIdentity'

type Props = {
  preview: UserPreview | undefined
  data: UserDrawerData | null
  error: DetailError | null
  returnTo: string
  onRetry: () => void
}

function GrantForm({ userId, returnTo }: { userId: string; returnTo: string }) {
  return (
    <form action={grantCreditsAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input
        name="credits"
        type="number"
        min={1}
        step={1}
        required
        placeholder="Credits"
        aria-label="Credits to grant"
        className={`${input} w-28`}
      />
      <SubmitButton className={button} pendingLabel="Granting" confirm="Grant these credits?">
        Grant credits
      </SubmitButton>
    </form>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="text-xs text-faint">{children}</p>
}

function Requests({ rows, tz }: { rows: UserDrawerData['requests']; tz: string }) {
  if (rows.length === 0) return <Empty>No reel requests</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border border-line px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <Status value={r.status} />
            <span className="text-faint">{fmtDate(r.created_at, tz)}</span>
          </div>
          <p className="mt-1 truncate text-muted">{truncate(r.urls[0] ?? '', 80)}</p>
          <div className="mt-1 flex items-center justify-between gap-3 text-faint">
            <span>
              via {r.via} · {r.credits_charged} credits{r.refunded ? ' (refunded)' : ''}
            </span>
            <Link href={`/create/${r.id}`} className="text-accent hover:underline">
              Open
            </Link>
          </div>
          {r.error && <p className="mt-1 text-danger">{truncate(r.error, 120)}</p>}
        </li>
      ))}
    </ul>
  )
}

function Ledger({ rows, tz }: { rows: UserDrawerData['ledger']; tz: string }) {
  if (rows.length === 0) return <Empty>No ledger entries this month</Empty>
  return (
    <ul className="divide-y divide-line/60 text-xs">
      {rows.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-muted">{e.reason}</span>
          <span className="text-faint">{fmtDate(e.created_at, tz)}</span>
          <span className={`w-12 text-right tabular-nums ${e.delta < 0 ? '' : 'text-ok'}`}>
            {e.delta > 0 ? `+${e.delta}` : e.delta}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Upgrades({ rows, tz }: { rows: UserDrawerData['upgrades']; tz: string }) {
  if (rows.length === 0) return <Empty>No upgrade requests</Empty>
  return (
    <ul className="space-y-2 text-xs">
      {rows.map((u) => (
        <li key={u.id} className="rounded-md border border-line px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <Status value={u.status} />
            <span className="text-faint">{fmtDate(u.created_at, tz)}</span>
          </div>
          {u.message && <p className="mt-1 text-muted">{truncate(u.message, 200)}</p>}
          {u.credits_granted !== null && (
            <p className="mt-1 text-faint">{u.credits_granted} credits granted</p>
          )}
        </li>
      ))}
    </ul>
  )
}

function Body({ data, returnTo }: { data: UserDrawerData; returnTo: string }) {
  const tz = useTimeZone()
  const { user } = data
  return (
    <div className="space-y-5">
      <UserIdentity user={user} avatarClass="h-12 w-12 text-lg" />
      <dl className="space-y-1.5">
        <KV k="Provider" v={providerLabel(user.provider)} />
        <KV k="Signed up" v={fmtDate(user.created_at, tz)} />
        <KV k="Last sign-in" v={fmtDate(user.last_sign_in_at, tz)} />
        <KV k="Reels requested" v={user.reel_count} />
        <KV k={`Credits used (${data.month})`} v={user.credits_used} />
        <KV k="Likes / saves" v={`${user.like_count} / ${user.save_count}`} />
      </dl>
      <Block title="Grant credits">
        <GrantForm userId={user.id} returnTo={returnTo} />
      </Block>
      <Block title="Recent reel requests">
        <Requests rows={data.requests} tz={tz} />
      </Block>
      <Block title={`Credit ledger, ${data.month}`}>
        <Ledger rows={data.ledger} tz={tz} />
      </Block>
      <Block title="Upgrade requests">
        <Upgrades rows={data.upgrades} tz={tz} />
      </Block>
    </div>
  )
}

/** User details: the clicked row's name at once, skeleton body until the API answers. */
export function UserDrawer({ preview, data, error, returnTo, onRetry }: Props) {
  if (data) return <Body data={data} returnTo={returnTo} />
  return (
    <div className="space-y-5">
      {preview?.name ? (
        <h2 className="text-base font-semibold leading-snug">{preview.name}</h2>
      ) : null}
      {error ? <DrawerError status={error.status} onRetry={onRetry} /> : <UserDrawerSkeleton />}
    </div>
  )
}
