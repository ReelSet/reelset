import {
  IG_LOGIN_FAILURE_ADVICE_AFTER,
  type IgAccount,
  type InstagramPublisher,
} from '@reelset/core'

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
      value: {
        code?: string
        username?: string
        password?: string
        totpSecret?: string
        accessToken?: string
      }
    }
  | { ok: false; message: string }

const field = (formData: FormData, name: string) => {
  const v = formData.get(name)
  return typeof v === 'string' ? v : ''
}

/**
 * Reads the connect form: an access token for the official API on its own, or an optional 2FA code
 * plus optional fresh credentials for the unofficial login.
 */
export function parseConnectForm(formData: FormData): ConnectForm {
  const accessToken = field(formData, 'accessToken').trim()
  if (accessToken) {
    if (!/^\S{20,2000}$/.test(accessToken))
      return { ok: false, message: 'That does not look like an Instagram access token' }
    return { ok: true, value: { accessToken } }
  }
  let code = field(formData, 'code').replace(/\s+/g, '')
  const username = field(formData, 'username').trim().replace(/^@/, '')
  const password = field(formData, 'password')
  const rawSecret = field(formData, 'totpSecret')
  let totpSecret = rawSecret.replace(/\s+/g, '').toUpperCase()
  // A 6-digit code typed into the setup-key box is the 2FA code; a password manager can also
  // autofill the password there. Neither is a setup key.
  if (/^\d{6,8}$/.test(totpSecret)) {
    code ||= totpSecret
    totpSecret = ''
  }
  if (rawSecret && rawSecret === password) totpSecret = ''
  if (code && !/^\d{6,8}$/.test(code))
    return { ok: false, message: 'The 2FA code is the 6-digit number from your authenticator app' }
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

function describeOfficialAccount(account: IgAccount | null): AccountView {
  const base = { suggestGraphApi: false, canConnect: false, needsCode: false }
  switch (account?.state) {
    case 'connected':
      return {
        ...base,
        tone: 'ok',
        headline: `Connected as @${account.username} via the official Instagram API`,
        detail: account.message,
      }
    case 'needs_login':
      return {
        ...base,
        tone: 'danger',
        headline: 'Access token rejected',
        detail: account.message ?? 'Paste a new access token to post again.',
      }
    case 'challenge':
      return {
        ...base,
        tone: 'warn',
        headline: 'Instagram restricted the account',
        detail: account.message ?? 'Open the Instagram app and follow its steps, then check again.',
      }
    case 'unknown':
      return { ...base, tone: 'muted', headline: 'Status unknown', detail: account.message }
    default:
      return {
        ...base,
        tone: 'muted',
        headline: 'No access token saved',
        detail: 'Paste an Instagram access token to connect. Queued posts wait until then.',
      }
  }
}

export function describeAccount(
  account: IgAccount | null,
  configured: boolean,
  publisher: InstagramPublisher = 'unofficial',
): AccountView {
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
  if (publisher === 'official') return describeOfficialAccount(account)
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
    return {
      ok: true,
      message: `Connected as @${account.username}${account.publisher === 'official' ? ' via the official Instagram API' : ''}`,
    }
  const view = describeAccount(account, true, account.publisher)
  const advice = view.suggestGraphApi ? ` ${GRAPH_API_ADVICE}` : ''
  return { ok: false, message: `${view.headline}. ${view.detail ?? ''}${advice}`.trim() }
}
