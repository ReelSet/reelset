import Link from 'next/link'
import { parseFlash, RETRY_STAGES, type RetryStage } from '@/lib/admin/retry'
import { pageHref } from '@/lib/admin/pagination'
import { discardItemAction, retryItemAction } from '@/app/admin/actions'
import { FlashToast } from './FlashToast'
import { SubmitButton } from './SubmitButton'

export const th =
  'whitespace-nowrap border-b border-line bg-raised/40 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-faint'
export const td = 'border-b border-line/60 px-3 py-2 align-top'
export const input =
  'rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none transition placeholder:text-faint focus:border-line-strong'
export const button =
  'inline-flex items-center rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs transition hover:bg-hover active:scale-95'
export const buttonPrimary =
  'inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition active:scale-95'

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full border-collapse text-[13px] [&_tbody_tr:hover]:bg-white/[0.02] [&_tbody_tr:last-child_td]:border-b-0">
        {children}
      </table>
    </div>
  )
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function PageTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {hint && <p className="mt-1 text-[13px] text-faint">{hint}</p>}
    </div>
  )
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: 'ok' | 'danger' | 'warn'
}) {
  const color =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'warn'
          ? 'text-warn'
          : ''
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</p>
    </div>
  )
}

export function Chips({
  items,
  active,
}: {
  items: { label: string; href: string; key: string }[]
  active: string | null
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`rounded-full border px-2.5 py-1 text-xs transition ${
            (active ?? 'all') === i.key
              ? 'border-line-strong bg-raised text-fg'
              : 'border-line text-muted hover:bg-raised/60 hover:text-fg'
          }`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  )
}

export function Empty({ children = 'Nothing here' }: { children?: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-md border border-dashed border-line px-4 py-8 text-center text-[13px] text-faint"
    >
      {children}
    </p>
  )
}

export function Flash({ value }: { value: string | string[] | undefined }) {
  const flash = parseFlash(value)
  if (!flash) return null
  return <FlashToast kind={flash.kind} message={flash.message} />
}

const STATUS_TONE: Record<string, string> = {
  failed: 'bg-danger',
  rendered: 'bg-ok',
  done: 'bg-ok',
  ok: 'bg-ok',
  empty: 'bg-faint',
  deferred: 'bg-warn',
  running: 'bg-info',
  rendering: 'bg-info',
  queued: 'bg-muted',
  insufficient_source: 'bg-warn',
  answered: 'bg-ok',
  error: 'bg-danger',
  spend_capped: 'bg-warn',
  rate_limited: 'bg-warn',
  no_evidence: 'bg-faint',
}

export function Status({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE[value] ?? 'bg-muted'}`} />
      {value}
    </span>
  )
}

export function Pager({
  path,
  params,
  page,
  hasMore,
}: {
  path: string
  params: Record<string, string | undefined>
  page: number
  hasMore: boolean
}) {
  if (page === 1 && !hasMore) return null
  return (
    <nav className="mt-3 flex items-center gap-3 text-xs">
      {page > 1 ? (
        <Link href={pageHref(path, params, page - 1)}>Prev</Link>
      ) : (
        <span className="text-faint/60">Prev</span>
      )}
      <span className="text-faint">Page {page}</span>
      {hasMore ? (
        <Link href={pageHref(path, params, page + 1)}>Next</Link>
      ) : (
        <span className="text-faint/60">Next</span>
      )}
    </nav>
  )
}

export function RetryItemForm({
  itemId,
  defaultStage,
  returnTo,
}: {
  itemId: string
  defaultStage: RetryStage
  returnTo: string
}) {
  return (
    <form action={retryItemAction} className="flex items-center gap-1">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <select name="stage" defaultValue={defaultStage} className={input}>
        {RETRY_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </select>
      <SubmitButton className={button} pendingLabel="Retrying">
        Retry
      </SubmitButton>
    </form>
  )
}

export function DiscardItemForm({ itemId, returnTo }: { itemId: string; returnTo: string }) {
  return (
    <form action={discardItemAction}>
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton className={button} pendingLabel="Discarding">
        Discard
      </SubmitButton>
    </form>
  )
}
