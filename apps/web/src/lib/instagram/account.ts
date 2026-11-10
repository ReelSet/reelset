import { IG_LOGIN_FAILURE_ADVICE_AFTER, type IgAccount } from '@reelset/core'

export type AccountView = {
  tone: 'ok' | 'warn' | 'danger' | 'muted'
  headline: string
  detail: string | null
  needsCode: boolean
  canConnect: boolean
  suggestGraphApi: boolean
}

export const GRAPH_API_ADVICE =
  'Several logins have failed. Stop retrying here: Instagram may lock the account. Consider the official Instagram Graph API instead.'

export function proxyLabel(account: IgAccount | null): string | null {
  const proxy = account?.proxy
  if (!proxy) return null
  if (proxy.down) return 'Proxy not responding'
  return `via proxy${proxy.country ? ` (exit ${proxy.country})` : ''}`
}

export function describeAccount(account: IgAccount | null, configured: boolean): AccountView {
  if (!configured) {
    return {
      tone: 'danger',
      headline: 'Poster not configured',
      detail: 'IG_ADMIN_URL and IG_ADMIN_TOKEN are missing from the web environment.',
      needsCode: false,
      canConnect: false,
      suggestGraphApi: false,
    }
  }
  const suggestGraphApi = (account?.loginFailures ?? 0) >= IG_LOGIN_FAILURE_ADVICE_AFTER
  const base = { suggestGraphApi, canConnect: true, needsCode: false }
  if (!account) {
    return {
      ...base,
      tone: 'muted',
      headline: 'Not checked yet',
      detail: 'Check the saved session first.',
    }
  }
  const proxyDown = account.proxy?.down === true
  switch (account.state) {
    case 'connected':
      return {
        ...base,
        tone: proxyDown ? 'warn' : 'ok',
        headline: `Connected as @${account.username}`,
        detail: proxyDown ? (account.message ?? 'Proxy not responding') : account.message,
      }
    case 'needs_code':
      return {
        ...base,
        tone: 'warn',
        headline: 'Waiting for your 2FA code',
        detail: 'Enter the 6-digit code from your authenticator app and connect.',
        needsCode: true,
      }
    case 'challenge':
      return {
        ...base,
        tone: 'warn',
        headline: 'Instagram wants approval',
        detail:
          account.message ?? 'Approve the login in the Instagram app, then connect once more.',
      }
    case 'needs_login':
      return {
        ...base,
        tone: 'danger',
        headline: 'Session expired',
        detail: account.message ?? 'Connect the account to post again.',
        needsCode: true,
      }
    default:
      return { ...base, tone: 'muted', headline: 'Status unknown', detail: account.message }
  }
}

export function accountFlash(account: IgAccount): { ok: boolean; message: string } {
  if (account.state === 'connected')
    return { ok: true, message: `Connected as @${account.username}` }
  const view = describeAccount(account, true)
  const advice = view.suggestGraphApi ? ` ${GRAPH_API_ADVICE}` : ''
  return { ok: false, message: `${view.headline}. ${view.detail ?? ''}${advice}`.trim() }
}
