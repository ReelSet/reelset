import { errorFields, type Logger } from '@reelset/core'
import { BOX_IDLE_PAUSE_SECONDS, BOX_RESUME_COOLDOWN_MS, NORTHFLANK_API_URL } from './constants'

export type BoxPowerState = 'running' | 'paused' | 'unknown'

export type BoxPower = {
  status(): Promise<BoxPowerState>
  resume(): Promise<'requested' | 'already_running' | 'skipped' | 'failed'>
  pause(): Promise<boolean>
}

export type BoxPowerConfig = {
  apiToken: string
  projectId: string
  serviceId: string
  log: Logger
  fetch?: typeof fetch
  now?: () => number
}

const CALL_TIMEOUT_MS = 15_000

export function createBoxPower(config: BoxPowerConfig): BoxPower {
  const call = config.fetch ?? ((input, init) => fetch(input, init))
  const now = config.now ?? Date.now
  const base = `${NORTHFLANK_API_URL}/projects/${config.projectId}/services/${config.serviceId}`
  const log = config.log.child({ component: 'box-power', serviceId: config.serviceId })
  let lastResumeAt = Number.NEGATIVE_INFINITY

  const request = (path: string, method: 'GET' | 'POST') =>
    call(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.apiToken}`, 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })

  const power: BoxPower = {
    async status() {
      try {
        const res = await request('', 'GET')
        if (!res.ok) {
          log.warn({ status: res.status }, 'northflank status call rejected')
          return 'unknown'
        }
        const body: unknown = await res.json().catch(() => null)
        return parsePowerState(body)
      } catch (err) {
        log.warn(errorFields(err), 'northflank status call failed')
        return 'unknown'
      }
    },

    async resume() {
      if (now() - lastResumeAt < BOX_RESUME_COOLDOWN_MS) return 'skipped'
      lastResumeAt = now()
      if ((await power.status()) === 'running') return 'already_running'
      try {
        const res = await request('/resume', 'POST')
        if (!res.ok) {
          log.error({ status: res.status }, 'northflank resume rejected')
          lastResumeAt = Number.NEGATIVE_INFINITY
          return 'failed'
        }
        log.info('render box resume requested')
        return 'requested'
      } catch (err) {
        log.error(errorFields(err), 'northflank resume failed')
        lastResumeAt = Number.NEGATIVE_INFINITY
        return 'failed'
      }
    },

    async pause() {
      try {
        const res = await request('/pause', 'POST')
        if (!res.ok) {
          log.error({ status: res.status }, 'northflank pause rejected')
          return false
        }
        log.info('render box paused')
        return true
      } catch (err) {
        log.error(errorFields(err), 'northflank pause failed')
        return false
      }
    },
  }
  return power
}

export function parsePowerState(body: unknown): BoxPowerState {
  const data =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as { data: unknown }).data
      : null
  if (typeof data !== 'object' || data === null) return 'unknown'
  const deployment = (data as { deployment?: { instances?: unknown } }).deployment
  const instances = deployment?.instances
  if (typeof instances !== 'number') return 'unknown'
  return instances === 0 ? 'paused' : 'running'
}

/** A paused service answers 503 with an empty body (checked live), so a non-JSON 502/503/504 means the box is down. */
export function isBoxDownResponse(res: Response): boolean {
  const down = res.status === 502 || res.status === 503 || res.status === 504
  return down && !(res.headers.get('content-type') ?? '').includes('application/json')
}

export type BoxHealth = { running: number; inflight: number; idleSeconds: number }

export function parseBoxHealth(body: unknown): BoxHealth | null {
  if (typeof body !== 'object' || body === null) return null
  const { running, inflight, idleSeconds } = body as Record<string, unknown>
  if (typeof running !== 'number' || typeof inflight !== 'number') return null
  if (typeof idleSeconds !== 'number') return null
  return { running, inflight, idleSeconds }
}

export function shouldPause(health: BoxHealth | null): boolean {
  return (
    health !== null &&
    health.running === 0 &&
    health.inflight === 0 &&
    health.idleSeconds >= BOX_IDLE_PAUSE_SECONDS
  )
}

export type PauseIdleDeps = {
  boxUrl: string
  power: Pick<BoxPower, 'pause'>
  log: Logger
  fetch?: typeof fetch
}

/** Pauses the box once it has been idle long enough; an unreachable or unreadable box is left alone. */
export async function pauseIdleBox(deps: PauseIdleDeps): Promise<'paused' | 'busy' | 'unknown'> {
  const call = deps.fetch ?? ((input, init) => fetch(input, init))
  let health: BoxHealth | null = null
  try {
    const res = await call(new URL('/health', deps.boxUrl), {
      signal: AbortSignal.timeout(10_000),
    })
    health = res.ok ? parseBoxHealth(await res.json().catch(() => null)) : null
  } catch (err) {
    deps.log.info(errorFields(err), 'render box health unreachable, leaving power as is')
  }
  if (health === null) return 'unknown'
  if (!shouldPause(health)) return 'busy'
  deps.log.info({ idleSeconds: health.idleSeconds }, 'render box idle, pausing')
  return (await deps.power.pause()) ? 'paused' : 'busy'
}
