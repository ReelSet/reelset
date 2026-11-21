import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context'

export type ServiceFetcher = { fetch: (input: string, init?: RequestInit) => Promise<Response> }

/** The bindings app code reads; the full set lives in wrangler.jsonc. */
export type WebBindings = {
  HYPERDRIVE?: { connectionString: string }
  INGEST?: ServiceFetcher
  RENDER?: ServiceFetcher
}

export type CfRequestContext = { env: WebBindings; ctx: object }

/** The current Workers request context, or undefined under Node (next dev, Vitest, next build). */
export function cfContext(): CfRequestContext | undefined {
  try {
    const { env, ctx } = getCloudflareContext()
    return { env: env as unknown as WebBindings, ctx: ctx as object }
  } catch {
    return undefined
  }
}

export function cfEnv(): WebBindings | undefined {
  return cfContext()?.env
}

/** Calls a service binding when present (no public hop), otherwise the public URL. */
export function serviceFetch(
  binding: ServiceFetcher | undefined,
  baseUrl: string | undefined,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (binding) return binding.fetch(`https://internal${path}`, init)
  if (!baseUrl) return Promise.reject(new Error(`no binding or URL for ${path}`))
  return fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, init)
}
