import type { IgAccount, IgCheckError } from '@reelset/core'
import { Ago } from '@/components/admin/pipeline/Elapsed'
import { button, buttonPrimary, input } from '@/components/admin/ui'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { GRAPH_API_ADVICE, describeAccount, proxyLabel } from '@/lib/instagram/account'
import {
  checkAccountAction,
  connectAccountAction,
  disconnectAccountAction,
} from '@/app/admin/instagram/actions'

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

      {configured && account?.state === 'disconnected' ? (
        <div className="mt-4 border-t border-line pt-4">
          <CredentialsForm returnTo={returnTo} />
        </div>
      ) : null}

      {configured && account && account.state !== 'disconnected' ? (
        <details className="group mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer select-none text-xs text-muted transition hover:text-fg">
            Use a different account or disconnect
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <CredentialsForm returnTo={returnTo} />
            <form
              action={disconnectAccountAction}
              className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/5 p-3"
            >
              <input type="hidden" name="returnTo" value={returnTo} />
              <p className="min-w-0 flex-1 text-xs text-muted">
                Disconnect forgets the saved session, its device ids and any credentials entered
                here. Queued posts wait until an account is connected again.
              </p>
              <SubmitButton
                className={`${button} border-danger/50 text-danger`}
                pendingLabel="Disconnecting"
              >
                Disconnect
              </SubmitButton>
            </form>
          </div>
        </details>
      ) : null}
    </section>
  )
}

function CredentialsForm({ returnTo }: { returnTo: string }) {
  return (
    <form action={connectAccountAction} className="flex flex-col gap-2.5" autoComplete="off">
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className="text-xs text-faint">
        Logs in from scratch as a new device. The credentials are stored encrypted and used for
        later reconnects.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          name="username"
          required
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          placeholder="Instagram username"
          aria-label="Instagram username"
          className={input}
        />
        <input
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Password"
          aria-label="Instagram password"
          className={input}
        />
        <input
          name="totpSecret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Authenticator setup key (optional)"
          aria-label="Authenticator setup key, optional"
          className={input}
        />
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,9}"
          placeholder="2FA code (optional)"
          aria-label="2FA code, optional"
          className={`${input} tabular-nums`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className={buttonPrimary} pendingLabel="Connecting">
          Connect with these credentials
        </SubmitButton>
        <p className="text-xs text-faint">One login attempt, never retried automatically.</p>
      </div>
    </form>
  )
}
