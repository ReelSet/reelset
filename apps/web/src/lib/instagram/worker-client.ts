import { igAccountSchema, type IgAccount } from '@reelset/core'
import { z } from 'zod'

export const WORKER_TIMEOUT_MS = { status: 60_000, connect: 100_000, run: 8_000 }

export type WorkerConfig = { baseUrl: string; token: string; fetch?: typeof fetch }

export type WorkerResult<T> = { ok: true; value: T } | { ok: false; message: string }

export function workerConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig | null {
  const baseUrl = env.IG_ADMIN_URL?.trim()
  const token = env.IG_ADMIN_TOKEN?.trim()
  return baseUrl && token ? { baseUrl: baseUrl.replace(/\/$/, ''), token } : null
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
    if (!res.ok) return { ok: false, message: `Poster answered ${res.status}` }
    const parsed = schema.safeParse(await res.json().catch(() => null))
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: 'Poster sent an unexpected answer' }
  } catch {
    return { ok: false, message: 'Could not reach the poster' }
  }
}

export const checkInstagramAccount = (config: WorkerConfig) =>
  call<IgAccount>(config, 'status', {}, WORKER_TIMEOUT_MS.status, igAccountSchema)

export const connectInstagramAccount = (config: WorkerConfig, code?: string) =>
  call<IgAccount>(
    config,
    'connect',
    code ? { code } : {},
    WORKER_TIMEOUT_MS.connect,
    igAccountSchema,
  )

export const kickInstagramQueue = (config: WorkerConfig) =>
  call(config, 'run', {}, WORKER_TIMEOUT_MS.run, z.object({ accepted: z.boolean() }))
