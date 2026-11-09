import type { Env } from './env'

export function containerEnvVars(env: Pick<Env, 'PROXY_URLS'>): Record<string, string> {
  const vars: Record<string, string> = {}
  const proxyUrls = env.PROXY_URLS?.trim()
  if (proxyUrls) vars.PROXY_URLS = proxyUrls
  return vars
}
