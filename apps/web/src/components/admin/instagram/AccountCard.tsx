import type { IgAccount, IgCheckError } from '@reelset/core'
import { Ago } from '@/components/admin/pipeline/Elapsed'
import { button, buttonPrimary, input } from '@/components/admin/ui'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { GRAPH_API_ADVICE, describeAccount, proxyLabel } from '@/lib/instagram/account'
import { checkAccountAction, connectAccountAction } from '@/app/admin/instagram/actions'

const DOT = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', muted: 'bg-faint' } as const

export function AccountCard({
  account,
  checkError,
  configured,
  returnTo,
}: {
  account: IgAccount | null
  checkError: IgCheckError | null
  configured: boolean
  returnTo: string
}) {
  const view = describeAccount(account, configured)
  const proxy = proxyLabel(account)
  const lastError =
    checkError && (!account || Date.parse(checkError.at) > Date.parse(account.checkedAt))
      ? checkError
      : null
  return (
    <section
      aria-label="Instagram account"
      className="mb-7 rounded-md border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <span className={`h-2 w-2 rounded-full ${DOT[view.tone]}`} />
            {view.headline}
          </p>
          {view.detail ? (
            <p className="mt-1 max-w-prose text-xs text-muted">{view.detail}</p>
          ) : null}
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-faint">
            {proxy ? (
              <span className={account?.proxy?.down ? 'text-warn' : ''}>{proxy}</span>
            ) : null}
            {account?.proxy?.switched && !account.proxy.down ? (
              <span className="text-warn">backup proxy in use</span>
            ) : null}
            {account ? (
              <span>
                checked <Ago at={account.checkedAt} />
              </span>
            ) : null}
          </p>
        </div>
        {configured ? (
          <form action={checkAccountAction}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton className={button} pendingLabel="Checking">
              Check session
            </SubmitButton>
          </form>
        ) : null}
      </div>

      {lastError ? (
        <p role="alert" className="mt-3 rounded bg-danger/10 p-2.5 text-xs text-danger">
          Last check failed <Ago at={lastError.at} />: {lastError.message}
        </p>
      ) : null}

      {view.canConnect && account && account.state !== 'connected' ? (
        <form
          action={connectAccountAction}
          className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4"
        >
          <input type="hidden" name="returnTo" value={returnTo} />
          {view.needsCode ? (
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,9}"
              placeholder="6-digit code"
              aria-label="2FA code"
              className={`${input} w-36 tabular-nums`}
            />
          ) : null}
          <SubmitButton className={buttonPrimary} pendingLabel="Connecting">
            Connect
          </SubmitButton>
          <p className="text-xs text-faint">
            One login attempt per click, never retried automatically.
          </p>
        </form>
      ) : null}

      {view.suggestGraphApi ? (
        <p className="mt-3 rounded bg-warn/10 p-2.5 text-xs text-warn">{GRAPH_API_ADVICE}</p>
      ) : null}
    </section>
  )
}
