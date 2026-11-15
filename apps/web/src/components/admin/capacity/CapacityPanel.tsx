import { fmtPct, fmtUsd } from '@/lib/admin/format'
import {
  DAY_MS,
  IDLE_RECLAIM_CPU,
  IDLE_WARN_CPU,
  averageRenderSeconds,
  boxRunStats,
  buildDailyRows,
  dayKey,
  dayRange,
  fmtAgo,
  hourRange,
  type DailyRow,
} from '@/lib/admin/capacity'
import { ChartCard, type LegendItem } from '@/components/admin/charts/ChartCard'
import { ComparisonBarChart } from '@/components/admin/charts/ComparisonBarChart'
import { LineSeriesChart, type LineDatum } from '@/components/admin/charts/LineSeriesChart'
import { CHART_COLORS } from '@/components/admin/charts/theme'
import { Disclosure, Empty, Stat, Table, td, th } from '@/components/admin/ui'
import { utcDayResetHint } from '@/lib/time/zone'
import { CAPACITY_DAYS, capacitySnapshot, type HourlyCpu } from '@/server/admin/capacity-queries'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

const OFFLINE_AFTER_SECONDS = 15 * 60
const BOX_COLORS = [CHART_COLORS.info, CHART_COLORS.accent, CHART_COLORS.warn, CHART_COLORS.violet]
const REELS_SERIES = [
  { key: 'rendered', label: 'Rendered', color: CHART_COLORS.ok },
  { key: 'capacity', label: 'Capacity', color: CHART_COLORS.faint },
  { key: 'failed', label: 'Failed', color: CHART_COLORS.danger },
]
const RENDER_TIME_SERIES = [
  { key: 'avg', label: 'Average', color: CHART_COLORS.info },
  { key: 'p90', label: 'p90', color: CHART_COLORS.warn },
]
const min1 = (v: number | null) => (v === null ? '-' : `${v.toFixed(1)}`)
const toSeries = ({ label, color }: LegendItem) => ({ key: label, label, color })
const boxSeriesLegend = (box: string, i: number): LegendItem => ({
  label: box,
  color: BOX_COLORS[i % BOX_COLORS.length]!,
})
const reelsLegend = (cap: number): LegendItem[] => [
  ...REELS_SERIES,
  { label: `Daily cap ${cap}`, color: CHART_COLORS.warn, dashed: true },
]

function renderTimeMax(rows: DailyRow[]): number {
  const peak = Math.max(10, ...rows.map((r) => r.p90Minutes ?? r.avgMinutes ?? 0))
  return Math.ceil(peak / 10) * 10
}

function cpuMax(hourly: HourlyCpu[]): number {
  return Math.max(40, Math.ceil(Math.max(...hourly.map((r) => r.cpu)) / 10) * 10)
}

function cpuData(boxes: string[], hours: string[], hourly: HourlyCpu[]): LineDatum[] {
  const byKey = new Map(hourly.map((r) => [`${r.box}|${r.hour.toISOString()}`, r.cpu]))
  return hours.map((hour) => ({
    x: hour,
    ...Object.fromEntries(boxes.map((b) => [b, byKey.get(`${b}|${hour}`) ?? null])),
  }))
}

/** Capacity summary, charts and per-box detail for the Renders tab; secondary tables are collapsed. */
export async function CapacityPanel({ tz }: { tz: string }) {
  const snap = await capacitySnapshot(getDb(), routeLog('admin/capacity'))

  const now = new Date()
  const days = dayRange(now, CAPACITY_DAYS)
  const boxes = [
    ...new Set([
      ...snap.latestSamples.map((s) => s.box),
      ...snap.samples.map((s) => s.box),
      ...snap.runs.flatMap((r) => (r.box ? [r.box] : [])),
    ]),
  ].sort()

  const rows = buildDailyRows({
    now,
    days,
    boxes,
    runs: snap.runs,
    samples: snap.samples,
    instagramByDay: snap.instagramByDay,
    spendByDay: snap.spendByDay,
  })
  const today = rows[rows.length - 1]!
  const avg7 = averageRenderSeconds(snap.runs, new Date(now.getTime() - 7 * DAY_MS), now)
  const hours = hourRange(now, 48)
  const latest = new Map(snap.latestSamples.map((s) => [s.box, s]))
  const p95 = new Map(snap.cpuP95.map((s) => [s.box, s]))
  const newestFirst = [...rows].reverse()
  const reelsData = rows.map((r) => ({
    day: r.day,
    rendered: r.rendered,
    capacity: r.capacity,
    failed: r.failed,
  }))
  const renderTimeData = rows.map((r) => ({ x: r.day, avg: r.avgMinutes, p90: r.p90Minutes }))

  return (
    <div>
      <p className="mb-4 text-xs text-faint">
        Capacity is what the online boxes could have rendered at the day's average render time.{' '}
        {utcDayResetHint(tz, now)}
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat
          label="Rendered today / cap"
          value={`${today.rendered} / ${snap.dailyCap}`}
          tone={today.rendered >= snap.dailyCap ? 'ok' : undefined}
        />
        <Stat label="Could have rendered today" value={today.capacity} />
        <Stat label="Box utilization today" value={fmtPct(today.utilization)} />
        <Stat
          label="Avg render time (7d)"
          value={avg7 === null ? '-' : `${(avg7 / 60).toFixed(0)} min`}
        />
        <Stat label="Queue backlog" value={snap.backlog} />
        <Stat
          label="Failed renders today"
          value={today.failed}
          tone={today.failed > 0 ? 'danger' : undefined}
        />
      </div>

      <div className="mb-9 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Reels per day" legend={reelsLegend(snap.dailyCap)}>
          <ComparisonBarChart
            data={reelsData}
            series={REELS_SERIES}
            referenceLine={{
              value: snap.dailyCap,
              label: `daily cap ${snap.dailyCap}`,
              color: CHART_COLORS.warn,
            }}
          />
        </ChartCard>
        <ChartCard title="Render time (minutes)" legend={RENDER_TIME_SERIES}>
          {renderTimeData.some((r) => r.avg !== null) ? (
            <LineSeriesChart
              data={renderTimeData}
              series={RENDER_TIME_SERIES}
              xKind="day"
              tz={tz}
              valueSuffix="m"
              yMax={renderTimeMax(rows)}
            />
          ) : (
            <Empty>No finished renders with timings yet</Empty>
          )}
        </ChartCard>
      </div>

      <Disclosure title="Box CPU, last 48 hours" summary={`${boxes.length} boxes`}>
        <p className="mb-3 text-xs text-faint">
          Oracle reclaims Always Free VMs whose 95th-percentile CPU over 7 days is under{' '}
          {IDLE_RECLAIM_CPU}%.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {boxes.map((b) => {
            const v = p95.get(b)?.p95 ?? null
            return (
              <Stat
                key={b}
                label={`${b} CPU P95 (7d)`}
                value={v === null ? '-' : `${v.toFixed(1)}%`}
                tone={v !== null && v < IDLE_WARN_CPU ? 'warn' : undefined}
              />
            )
          })}
        </div>
        {snap.hourlyCpu.length === 0 ? (
          <Empty>No box samples yet</Empty>
        ) : (
          <ChartCard title="Hourly average CPU per box" legend={boxes.map(boxSeriesLegend)}>
            <LineSeriesChart
              data={cpuData(boxes, hours, snap.hourlyCpu)}
              series={boxes.map(boxSeriesLegend).map(toSeries)}
              xKind="hour"
              tz={tz}
              valueSuffix="%"
              yMax={cpuMax(snap.hourlyCpu)}
              reference={{
                value: IDLE_RECLAIM_CPU,
                label: `Oracle idle-reclaim threshold (${IDLE_RECLAIM_CPU}%)`,
              }}
            />
          </ChartCard>
        )}
      </Disclosure>

      <Disclosure title="Boxes" summary={`${boxes.length} reporting`}>
        {boxes.length === 0 ? (
          <Empty>No boxes have reported or rendered yet</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Box</th>
                <th className={th}>State</th>
                <th className={th}>Last seen</th>
                <th className={th}>Rendering</th>
                <th className={th}>Idle for</th>
                <th className={th}>CPU</th>
                <th className={th}>Load</th>
                <th className={th}>Mem MB</th>
                <th className={th}>Swap MB</th>
                <th className={th}>Done 24h</th>
                <th className={th}>Done 7d</th>
                <th className={th}>Busy h today</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => {
                const s = latest.get(b)
                const seen = s ? (now.getTime() - s.at.getTime()) / 1000 : null
                const online =
                  s !== undefined && s.ok && seen !== null && seen < OFFLINE_AFTER_SECONDS
                const stats = boxRunStats(snap.runs, b, now)
                return (
                  <tr key={b}>
                    <td className={td}>{b}</td>
                    <td
                      className={`${td} ${s ? (online ? 'text-ok' : 'text-danger') : 'text-faint'}`}
                    >
                      {s ? (online ? 'ok' : 'offline') : 'no samples'}
                    </td>
                    <td className={td}>{seen === null ? '-' : `${fmtAgo(seen)} ago`}</td>
                    <td className={td}>{s ? (s.running > 0 ? 'yes' : 'no') : '-'}</td>
                    <td className={td}>{fmtAgo(s?.idleSeconds ?? null)}</td>
                    <td className={td}>{s?.cpuPct == null ? '-' : `${s.cpuPct.toFixed(0)}%`}</td>
                    <td className={td}>{s?.load1 == null ? '-' : s.load1.toFixed(2)}</td>
                    <td className={td}>{s?.memUsedMb ?? '-'}</td>
                    <td className={td}>{s?.swapUsedMb ?? '-'}</td>
                    <td className={td}>{stats.done24h}</td>
                    <td className={td}>{stats.done7d}</td>
                    <td className={td}>{stats.busyHoursToday.toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Disclosure>

      <Disclosure title="Daily numbers" summary="last 30 days">
        <Table>
          <thead>
            <tr>
              <th className={th}>Day</th>
              <th className={th}>Rendered</th>
              <th className={th}>Failed</th>
              <th className={th}>Capacity</th>
              <th className={th}>Utilization</th>
              <th className={th}>Avg min</th>
              <th className={th}>Instagram</th>
              <th className={th}>Spend</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((r) => (
              <tr key={r.day}>
                <td className={td}>{r.day}</td>
                <td className={td}>{r.rendered}</td>
                <td className={`${td} ${r.failed > 0 ? 'text-danger' : ''}`}>{r.failed}</td>
                <td className={td}>{r.capacity}</td>
                <td className={td}>{fmtPct(r.utilization)}</td>
                <td className={td}>{min1(r.avgMinutes)}</td>
                <td className={td}>{r.instagram}</td>
                <td className={td}>{fmtUsd(r.spendUsd)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-faint">Today is {dayKey(now)} (UTC), counted up to now.</p>
      </Disclosure>
    </div>
  )
}
