import { errorFields, type Logger } from '@reelset/core'
import { BOX_HEALTH_TIMEOUT_MS } from './constants'

/** A box that is off answers 502/503/504 with an empty body; 530 is Cloudflare's offline-tunnel page. */
export function isBoxDownResponse(res: Response): boolean {
  const down = [502, 503, 504, 530].includes(res.status)
  return down && !(res.headers.get('content-type') ?? '').includes('application/json')
}

export type BoxHealth = {
  box: string | null
  running: number
  inflight: number
  idleSeconds: number
  cpuPct: number | null
  load1: number | null
  memUsedMb: number | null
  swapUsedMb: number | null
}

const optionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export function parseBoxHealth(body: unknown): BoxHealth | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const { running, inflight, idleSeconds } = record
  if (typeof running !== 'number' || typeof inflight !== 'number') return null
  if (typeof idleSeconds !== 'number') return null
  return {
    box: typeof record.box === 'string' && record.box ? record.box : null,
    running,
    inflight,
    idleSeconds,
    cpuPct: optionalNumber(record.cpuPct),
    load1: optionalNumber(record.load1),
    memUsedMb: optionalNumber(record.memUsedMb),
    swapUsedMb: optionalNumber(record.swapUsedMb),
  }
}

export type BoxSampleRow = {
  box: string
  ok: boolean
  running: number
  inflight: number
  idle_seconds: number | null
  cpu_pct: number | null
  load1: number | null
  mem_used_mb: number | null
  swap_used_mb: number | null
}

export type BoxSampleStore = { insertBoxSample(row: BoxSampleRow): Promise<void> }

export type SampleBoxesDeps = {
  urls: string[]
  store: BoxSampleStore
  log: Logger
  fetch?: typeof fetch
}

function unreachableRow(box: string): BoxSampleRow {
  return {
    box,
    ok: false,
    running: 0,
    inflight: 0,
    idle_seconds: null,
    cpu_pct: null,
    load1: null,
    mem_used_mb: null,
    swap_used_mb: null,
  }
}

async function sampleOne(url: string, deps: SampleBoxesDeps): Promise<BoxSampleRow> {
  const call = deps.fetch ?? ((input, init) => fetch(input, init))
  const host = new URL(url).host
  const log = deps.log.child({ box: host })
  try {
    const res = await call(new URL('/health', url), {
      signal: AbortSignal.timeout(BOX_HEALTH_TIMEOUT_MS),
    })
    const health = res.ok ? parseBoxHealth(await res.json().catch(() => null)) : null
    if (!health) {
      log.warn({ status: res.status }, 'box health unreadable')
      return unreachableRow(host)
    }
    return {
      box: health.box ?? host,
      ok: true,
      running: health.running,
      inflight: health.inflight,
      idle_seconds: health.idleSeconds,
      cpu_pct: health.cpuPct,
      load1: health.load1,
      mem_used_mb: health.memUsedMb,
      swap_used_mb: health.swapUsedMb,
    }
  } catch (err) {
    log.warn(errorFields(err), 'box health unreachable')
    return unreachableRow(host)
  }
}

/** Records one box_sample row per box; a failed insert for one box never stops the others. */
export async function sampleBoxes(deps: SampleBoxesDeps): Promise<BoxSampleRow[]> {
  const rows = await Promise.all(deps.urls.map((url) => sampleOne(url, deps)))
  await Promise.all(
    rows.map(async (row) => {
      try {
        await deps.store.insertBoxSample(row)
      } catch (err) {
        deps.log.error({ box: row.box, ...errorFields(err) }, 'box sample insert failed')
      }
    }),
  )
  deps.log.info(
    { boxes: rows.map((r) => ({ box: r.box, ok: r.ok, cpuPct: r.cpu_pct })) },
    'box health sampled',
  )
  return rows
}
