// Client-safe admin primitives: no server actions or core imports, so client components can use them.

export const th =
  'whitespace-nowrap border-b border-line bg-raised/40 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-faint'
export const td = 'border-b border-line/60 px-3 py-2 align-top'
export const input =
  'rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none transition placeholder:text-faint focus:border-line-strong'
export const button =
  'inline-flex items-center rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs transition hover:bg-hover active:scale-95'
export const buttonPrimary =
  'inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition active:scale-95'

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
