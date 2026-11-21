import { igAccountSchema, type IgAccount } from '@reelset/core'
import { z } from 'zod'
import { cfEnv, type WebBindings } from '@/server/cf'

export const WORKER_TIMEOUT_MS = { status: 60_000, connect: 280_000, run: 8_000 }

export type WorkerConfig = { baseUrl: string; token: string; fetch?: typeof fetch }

export type WorkerResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** Prefers the RENDER service binding on Workers, which skips the public hop on 280 s connects. */
export function workerConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  bindings: WebBindings | undefined = cfEnv(),
): WorkerConfig | null {
  const baseUrl = env.IG_ADMIN_URL?.trim()
  const token = env.IG_ADMIN_TOKEN?.trim()
  if (!token) return null
  const render = bindings?.RENDER
  if (render) {
    const viaBinding = (url: string, init?: RequestInit) => render.fetch(url, init)
    return { baseUrl: 'https://internal', token, fetch: viaBinding as typeof fetch }
  }
  return baseUrl ? { baseUrl: baseUrl.replace(/\/$/, ''), token } : null
}

async function call<T>(
  config: WorkerConfig,
  path: string,
  body: unknown,
  timeoutMs: number,
  schema: z.ZodType<T>,
): Promise<WorkerResult<T>> {
  try {
    const res = await (config.fetch ?? fetch)(`${config.baseUrl}/admin/ig/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, message: `The Instagram service answered ${res.status}` }
    const parsed = schema.safeParse(await res.json().catch(() => null))
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: 'The Instagram service sent an unexpected answer' }
  } catch {
    return {
      ok: false,
      message: 'Could not reach the Instagram service. It may still be deploying or offline.',
    }
  }
}

export const checkInstagramAccount = (config: WorkerConfig) =>
  call<IgAccount>(config, 'status', {}, WORKER_TIMEOUT_MS.status, igAccountSchema)

export type ConnectRequest = {
  code?: string
  username?: string
  password?: string
  totpSecret?: string
  accessToken?: string
}

export const connectInstagramAccount = (config: WorkerConfig, request: ConnectRequest = {}) =>
  call<IgAccount>(
    config,
    'connect',
    Object.fromEntries(Object.entries(request).filter(([, v]) => v)),
    WORKER_TIMEOUT_MS.connect,
    igAccountSchema,
  )

export const disconnectInstagramAccount = (config: WorkerConfig) =>
  call<IgAccount>(config, 'disconnect', {}, WORKER_TIMEOUT_MS.status, igAccountSchema)

export const kickInstagramQueue = (config: WorkerConfig) =>
  call(config, 'run', {}, WORKER_TIMEOUT_MS.run, z.object({ accepted: z.boolean() }))
