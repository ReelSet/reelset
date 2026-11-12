import { SETTINGS, getSetting, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import { ACTIVE_STATUSES } from '@/lib/admin/pipeline'
import type { RenderRun, SampleDay } from '@/lib/admin/capacity'

export const CAPACITY_DAYS = 30
const dayOf = (column: string) =>
  sql<string>`to_char((${sql.ref(column)} at time zone 'utc')::date, 'YYYY-MM-DD')`

export type LatestSample = {
  box: string
  at: Date
  ok: boolean
  running: number
  idleSeconds: number | null
  cpuPct: number | null
  load1: number | null
  memUsedMb: number | null
  swapUsedMb: number | null
}

export type HourlyCpu = { box: string; hour: Date; cpu: number }
export type BoxCpuP95 = { box: string; p95: number | null; samples: number }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function capacitySnapshot(db: Database, log: Logger) {
  const days = CAPACITY_DAYS
  const [runRows, sampleDays, latest, hourly, p95s, backlog, igRows, spendRows, dailyCap] =
    await Promise.all([
      db
        .selectFrom('render')
        .select(['box', 'status', 'started_at', 'finished_at', 'render_ms'])
        .where('status', 'in', ['done', 'failed'])
        .where('finished_at', '>=', sql<Date>`now() - make_interval(days => ${days + 1})`)
        .execute(),
      db
        .selectFrom('box_sample')
        .select([
          'box',
          dayOf('at').as('day'),
          sql<string>`count(*)`.as('total'),
          sql<string>`count(*) filter (where ok)`.as('ok'),
        ])
        .where('at', '>=', sql<Date>`now() - make_interval(days => ${days + 1})`)
        .groupBy(['box', sql`2`])
        .execute(),
      db
        .selectFrom('box_sample')
        .distinctOn('box')
        .select([
          'box',
          'at',
          'ok',
          'running',
          'idle_seconds',
          'cpu_pct',
          'load1',
          'mem_used_mb',
          'swap_used_mb',
        ])
        .orderBy('box')
        .orderBy('at', 'desc')
        .execute(),
      db
        .selectFrom('box_sample')
        .select([
          'box',
          sql<Date>`date_trunc('hour', at)`.as('hour'),
          sql<string>`avg(cpu_pct)`.as('cpu'),
        ])
        .where('at', '>=', sql<Date>`now() - interval '48 hours'`)
        .where('cpu_pct', 'is not', null)
        .groupBy(['box', sql`2`])
        .execute(),
      db
        .selectFrom('box_sample')
        .select([
          'box',
          sql<string | null>`percentile_cont(0.95) within group (order by cpu_pct)`.as('p95'),
          sql<string>`count(cpu_pct)`.as('n'),
        ])
        .where('at', '>=', sql<Date>`now() - interval '7 days'`)
        .where('cpu_pct', 'is not', null)
        .groupBy('box')
        .execute(),
      db
        .selectFrom('item')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('status', 'in', [...ACTIVE_STATUSES])
        .where(sql<boolean>`(status <> 'found' or queued_at is not null)`)
        .executeTakeFirst(),
      db
        .selectFrom('instagram_post')
        .select([dayOf('posted_at').as('day'), sql<string>`count(*)`.as('n')])
        .where('status', '=', 'posted')
        .where('posted_at', '>=', sql<Date>`now() - make_interval(days => ${days + 1})`)
        .groupBy(sql`1`)
        .execute(),
      db
        .selectFrom('spend_ledger')
        .select([dayOf('day').as('day'), sql<string>`sum(cost_usd)`.as('usd')])
        .where('day', '>=', sql<Date>`(now() at time zone 'utc')::date - ${days}::int`)
        .groupBy(sql`1`)
        .execute(),
      getSetting(db, SETTINGS.dailyReelCap, log),
    ])

  const runs: RenderRun[] = runRows.map((r) => ({
    box: r.box,
    status: r.status,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
    renderMs: r.render_ms,
  }))
  const samples: SampleDay[] = sampleDays.map((r) => ({
    box: r.box,
    day: r.day,
    total: Number(r.total),
    ok: Number(r.ok),
  }))
  const latestSamples: LatestSample[] = latest.map((r) => ({
    box: r.box,
    at: new Date(r.at),
    ok: r.ok,
    running: r.running,
    idleSeconds: r.idle_seconds,
    cpuPct: num(r.cpu_pct),
    load1: num(r.load1),
    memUsedMb: r.mem_used_mb,
    swapUsedMb: r.swap_used_mb,
  }))
  const hourlyCpu: HourlyCpu[] = hourly.map((r) => ({
    box: r.box,
    hour: new Date(r.hour),
    cpu: Number(r.cpu),
  }))
  const cpuP95: BoxCpuP95[] = p95s.map((r) => ({
    box: r.box,
    p95: num(r.p95),
    samples: Number(r.n),
  }))

  return {
    runs,
    samples,
    latestSamples,
    hourlyCpu,
    cpuP95,
    backlog: Number(backlog?.n ?? 0),
    instagramByDay: new Map<string, number>(igRows.map((r) => [String(r.day), Number(r.n)])),
    spendByDay: new Map<string, number>(spendRows.map((r) => [String(r.day), Number(r.usd)])),
    dailyCap,
  }
}

export type CapacitySnapshot = Awaited<ReturnType<typeof capacitySnapshot>>
