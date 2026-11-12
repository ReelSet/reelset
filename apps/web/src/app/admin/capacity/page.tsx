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
import { Empty, PageTitle, Section, Stat, Table, td, th } from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import { CAPACITY_DAYS, capacitySnapshot, type HourlyCpu } from '@/server/admin/capacity-queries'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const metadata = { title: 'Capacity' }

const OFFLINE_AFTER_SECONDS = 15 * 60
const BOX_COLORS = ['#6cb6ff', '#c8f751', '#f5b84b', '#b4a0ff']
const boxColor = (i: number) => BOX_COLORS[i % BOX_COLORS.length]!
const min1 = (v: number | null) => (v === null ? '-' : `${v.toFixed(1)}`)

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

function ReelsChart({ rows, cap }: { rows: DailyRow[]; cap: number }) {
  const peak = Math.max(1, cap, ...rows.map((r) => Math.max(r.capacity, r.rendered, r.failed)))
  const pct = (v: number) => `${(v / peak) * 100}%`
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div
        className="relative flex h-44 items-end gap-1.5"
        role="img"
        aria-label="Reels rendered per day against capacity"
      >
        {rows.map((r) => (
          <div
            key={r.day}
            className="group flex h-full flex-1 items-end gap-px"
            title={`${r.day}: ${r.rendered} rendered of ${r.capacity} possible, ${r.failed} failed`}
          >
            <div className="relative h-full flex-1">
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-faint/30"
                style={{ height: pct(r.capacity) }}
              />
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-ok transition-opacity group-hover:opacity-80"
                style={{ height: pct(r.rendered) }}
              />
            </div>
            {r.failed > 0 && (
              <div
                className="w-[3px] self-end rounded-t-[2px] bg-danger"
                style={{ height: pct(r.failed) }}
              />
            )}
          </div>
        ))}
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn"
          style={{ bottom: pct(cap) }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{rows[0]?.day}</span>
        <span>peak {peak}</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  )
}

function lineSegments(values: (number | null)[], max: number, w: number, h: number): string[] {
  const segments: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current.join(' '))
      current = []
      return
    }
    const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w
    current.push(`${x.toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
  })
  if (current.length) segments.push(current.join(' '))
  return segments
}

function Lines({
  series,
  max,
  guide,
  label,
}: {
  series: { color: string; values: (number | null)[] }[]
  max: number
  guide?: { value: number; label: string }
  label: string
}) {
  const w = 300
  const h = 100
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-44 w-full overflow-visible"
        role="img"
        aria-label={label}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={w}
            y1={h * f}
            y2={h * f}
            stroke="currentColor"
            className="text-line"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {guide && (
          <line
            x1="0"
            x2={w}
            y1={h - (guide.value / max) * h}
            y2={h - (guide.value / max) * h}
            stroke="#ff6b6b"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {series.map((s) =>
          lineSegments(s.values, max, w, h).map((points, i) => (
            <polyline
              key={`${s.color}-${i}`}
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
      </svg>
      {guide && (
        <span
          className="pointer-events-none absolute left-1 text-[10px] text-danger"
          style={{ bottom: `calc(${(guide.value / max) * 100}% + 2px)` }}
        >
          {guide.label}
        </span>
      )}
      <span className="absolute right-1 top-0 text-[10px] text-faint">{max}</span>
    </div>
  )
}

function RenderTimeChart({ rows }: { rows: DailyRow[] }) {
  const has = rows.some((r) => r.avgMinutes !== null)
  if (!has) return <Empty>No finished renders with timings yet</Empty>
  const max =
    Math.ceil(Math.max(10, ...rows.map((r) => r.p90Minutes ?? r.avgMinutes ?? 0)) / 10) * 10
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <Lines
        label="Average and p90 render minutes per day"
        max={max}
        series={[
          { color: '#6cb6ff', values: rows.map((r) => r.avgMinutes) },
          { color: '#f5b84b', values: rows.map((r) => r.p90Minutes) },
        ]}
      />
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{rows[0]?.day}</span>
        <span>minutes</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  )
}

function CpuChart({
  boxes,
  hours,
  hourly,
}: {
  boxes: string[]
  hours: string[]
  hourly: HourlyCpu[]
}) {
  if (hourly.length === 0) return <Empty>No box samples yet</Empty>
  const byKey = new Map(hourly.map((r) => [`${r.box}|${r.hour.toISOString()}`, r.cpu]))
  const max = Math.max(40, Math.ceil(Math.max(...hourly.map((r) => r.cpu)) / 10) * 10)
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <Lines
        label="Hourly average CPU per box"
        max={max}
        guide={{
          value: IDLE_RECLAIM_CPU,
          label: `Oracle idle-reclaim threshold (${IDLE_RECLAIM_CPU}%)`,
        }}
        series={boxes.map((b, i) => ({
          color: boxColor(i),
          values: hours.map((h) => byKey.get(`${b}|${h}`) ?? null),
        }))}
      />
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{hours[0]?.slice(5, 16).replace('T', ' ')} UTC</span>
        <span>CPU %</span>
        <span>{hours[hours.length - 1]?.slice(5, 16).replace('T', ' ')} UTC</span>
      </div>
    </div>
  )
}

export default async function CapacityPage() {
  await assertAdmin()
  const db = getDb()
  const log = routeLog('admin/capacity')
  const snap = await capacitySnapshot(db, log)

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

  return (
    <div>
      <PageTitle
        title="Capacity"
        hint="Render throughput of the boxes against the daily cap, UTC. Capacity is what the online boxes could have rendered at the day's average render time."
      />
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

      <Section
        title="Reels per day"
        aside={
          <Legend
            items={[
              { label: 'rendered', color: 'var(--color-ok, #4ade80)' },
              { label: 'capacity', color: 'rgb(161 161 170 / 0.3)' },
              { label: 'failed', color: 'var(--color-danger, #ff6b6b)' },
              { label: `daily cap ${snap.dailyCap}`, color: 'var(--color-warn, #f5b84b)' },
            ]}
          />
        }
      >
        <ReelsChart rows={rows} cap={snap.dailyCap} />
      </Section>

      <Section
        title="Render time"
        aside={
          <Legend
            items={[
              { label: 'average', color: '#6cb6ff' },
              { label: 'p90', color: '#f5b84b' },
            ]}
          />
        }
      >
        <RenderTimeChart rows={rows} />
      </Section>

      <Section
        title="Box CPU (last 48 h)"
        aside={<Legend items={boxes.map((b, i) => ({ label: b, color: boxColor(i) }))} />}
      >
        <p className="mb-3 text-xs text-faint">
          Oracle reclaims Always Free VMs whose 95th-percentile CPU over 7 days is under{' '}
          {IDLE_RECLAIM_CPU}%.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
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
        <CpuChart boxes={boxes} hours={hours} hourly={snap.hourlyCpu} />
      </Section>

      <Section title="Boxes">
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
      </Section>

      <Section title="Daily">
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
        <p className="mt-2 text-xs text-faint">Today is {dayKey(now)}, counted up to now.</p>
      </Section>
    </div>
  )
}
