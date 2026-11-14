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

export type ConnectForm =
  | {
      ok: true
      value: { code?: string; username?: string; password?: string; totpSecret?: string }
    }
  | { ok: false; message: string }

const field = (formData: FormData, name: string) => {
  const v = formData.get(name)
  return typeof v === 'string' ? v : ''
}

/** Reads the connect form: an optional 2FA code, plus optional fresh credentials. */
export function parseConnectForm(formData: FormData): ConnectForm {
  const code = field(formData, 'code').replace(/\s+/g, '')
  const username = field(formData, 'username').trim().replace(/^@/, '')
  const password = field(formData, 'password')
  const totpSecret = field(formData, 'totpSecret').replace(/\s+/g, '').toUpperCase()
  if (code && !/^\d{6,8}$/.test(code)) return { ok: false, message: 'The 2FA code is 6 digits' }
  if (Boolean(username) !== Boolean(password))
    return { ok: false, message: 'Enter both the username and the password' }
  if (username.length > 64 || password.length > 256)
    return { ok: false, message: 'Username or password is too long' }
  if (totpSecret && !username)
    return { ok: false, message: 'An authenticator secret needs a username and password' }
  if (totpSecret && !/^[A-Z2-7=]{16,128}$/.test(totpSecret))
    return { ok: false, message: 'The authenticator secret should be the base32 setup key' }
  return {
    ok: true,
    value: {
      ...(code ? { code } : {}),
      ...(username ? { username, password } : {}),
      ...(totpSecret ? { totpSecret } : {}),
    },
  }
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
    case 'disconnected':
      return {
        ...base,
        canConnect: false,
        tone: 'muted',
        headline: 'Disconnected',
        detail:
          account.message ??
          'No account is connected. Enter a username and password to connect one. Queued posts wait until then.',
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
