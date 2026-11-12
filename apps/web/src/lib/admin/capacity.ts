export const DAY_MS = 86_400_000
export const SAMPLE_MINUTES = 5
export const DEFAULT_RENDER_SECONDS = 75 * 60
export const IDLE_RECLAIM_CPU = 20
export const IDLE_WARN_CPU = 25

export type RenderRun = {
  box: string | null
  status: string
  startedAt: Date | null
  finishedAt: Date | null
  renderMs: number | null
}

export type SampleDay = { box: string; day: string; total: number; ok: number }

export type DayStats = {
  done: number
  failed: number
  avgSeconds: number | null
  p90Seconds: number | null
}

export type DailyRow = {
  day: string
  rendered: number
  failed: number
  capacity: number
  utilization: number | null
  avgMinutes: number | null
  p90Minutes: number | null
  instagram: number
  spendUsd: number
}

export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo)
}

export const p95 = (values: number[]) => percentile(values, 0.95)

export const dayKey = (d: Date) => d.toISOString().slice(0, 10)
export const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`)

// Oldest to newest, ending on the UTC day of `now`.
export function dayRange(now: Date, count: number): string[] {
  const today = dayStartMs(dayKey(now))
  return Array.from({ length: count }, (_, i) => dayKey(new Date(today - (count - 1 - i) * DAY_MS)))
}

export function hourRange(now: Date, count: number): string[] {
  const hour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  return Array.from({ length: count }, (_, i) =>
    new Date(hour - (count - 1 - i) * 3_600_000).toISOString(),
  )
}

// Seconds of the day that have elapsed (full day for past days, up to now for today, 0 for future).
export function daySecondsElapsed(day: string, now: Date): number {
  const start = dayStartMs(day)
  return Math.min(DAY_MS, Math.max(0, now.getTime() - start)) / 1000
}

export function runInterval(run: RenderRun): [number, number] | null {
  if (!run.finishedAt) return null
  const end = run.finishedAt.getTime()
  const start = run.startedAt
    ? run.startedAt.getTime()
    : run.renderMs !== null
      ? end - run.renderMs
      : null
  if (start === null || end <= start) return null
  return [start, end]
}

const finished = (run: RenderRun) => run.status === 'done' || run.status === 'failed'

// box -> day -> busy seconds, with each run clipped to the days it overlaps.
export function busySecondsByBoxDay(
  runs: RenderRun[],
  days: string[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const run of runs) {
    if (!run.box || !finished(run)) continue
    const interval = runInterval(run)
    if (!interval) continue
    for (const day of days) {
      const start = dayStartMs(day)
      const overlap = Math.min(interval[1], start + DAY_MS) - Math.max(interval[0], start)
      if (overlap <= 0) continue
      const perDay = out.get(run.box) ?? new Map<string, number>()
      perDay.set(day, (perDay.get(day) ?? 0) + overlap / 1000)
      out.set(run.box, perDay)
    }
  }
  return out
}

export function dayStats(runs: RenderRun[], days: string[]): Map<string, DayStats> {
  const durations = new Map<string, number[]>()
  const stats = new Map<string, DayStats>(
    days.map((d) => [d, { done: 0, failed: 0, avgSeconds: null, p90Seconds: null }]),
  )
  for (const run of runs) {
    if (!run.finishedAt) continue
    const s = stats.get(dayKey(run.finishedAt))
    if (!s) continue
    if (run.status === 'failed') s.failed += 1
    if (run.status !== 'done') continue
    s.done += 1
    if (run.renderMs !== null && run.renderMs > 0) {
      const list = durations.get(dayKey(run.finishedAt)) ?? []
      list.push(run.renderMs / 1000)
      durations.set(dayKey(run.finishedAt), list)
    }
  }
  for (const [day, list] of durations) {
    const s = stats.get(day)!
    s.avgSeconds = list.reduce((a, b) => a + b, 0) / list.length
    s.p90Seconds = percentile(list, 0.9)
  }
  return stats
}

export function averageRenderSeconds(runs: RenderRun[], since: Date, until: Date): number | null {
  const list = runs
    .filter(
      (r) =>
        r.status === 'done' &&
        r.renderMs !== null &&
        r.renderMs > 0 &&
        r.finishedAt !== null &&
        r.finishedAt >= since &&
        r.finishedAt <= until,
    )
    .map((r) => r.renderMs! / 1000)
  return list.length === 0 ? null : list.reduce((a, b) => a + b, 0) / list.length
}

// Share of the day's samples with ok=true; without samples assume 1 if the box rendered that day.
export function onlineFraction(sample: SampleDay | undefined, renderedThatDay: boolean): number {
  if (sample && sample.total > 0) return Math.min(1, sample.ok / sample.total)
  return renderedThatDay ? 1 : 0
}

export function dayCapacity(
  onlineBoxSeconds: number,
  dayAvgSeconds: number | null,
  doneCount: number,
  trailingAvgSeconds: number | null,
): number {
  const avg =
    doneCount >= 2 && dayAvgSeconds ? dayAvgSeconds : (trailingAvgSeconds ?? DEFAULT_RENDER_SECONDS)
  return avg > 0 ? Math.floor(onlineBoxSeconds / avg) : 0
}

export function utilization(busySeconds: number, onlineSeconds: number): number | null {
  if (onlineSeconds <= 0) return null
  return Math.min(1, busySeconds / onlineSeconds)
}

export type CapacityInput = {
  now: Date
  days: string[]
  boxes: string[]
  runs: RenderRun[]
  samples: SampleDay[]
  instagramByDay: Map<string, number>
  spendByDay: Map<string, number>
}

export function buildDailyRows(input: CapacityInput): DailyRow[] {
  const { now, days, boxes, runs, samples, instagramByDay, spendByDay } = input
  const busy = busySecondsByBoxDay(runs, days)
  const stats = dayStats(runs, days)
  const sampleMap = new Map(samples.map((s) => [`${s.box}|${s.day}`, s]))
  const rendered = new Set(
    runs
      .filter((r) => r.box && r.finishedAt && finished(r))
      .map((r) => `${r.box}|${dayKey(r.finishedAt!)}`),
  )

  return days.map((day) => {
    const elapsed = daySecondsElapsed(day, now)
    let onlineSeconds = 0
    let busySeconds = 0
    for (const box of boxes) {
      const fraction = onlineFraction(sampleMap.get(`${box}|${day}`), rendered.has(`${box}|${day}`))
      onlineSeconds += fraction * elapsed
      busySeconds += busy.get(box)?.get(day) ?? 0
    }
    const s = stats.get(day)!
    const dayEnd = new Date(Math.min(now.getTime(), dayStartMs(day) + DAY_MS))
    const trailing = averageRenderSeconds(runs, new Date(dayStartMs(day) - 6 * DAY_MS), dayEnd)
    return {
      day,
      rendered: s.done,
      failed: s.failed,
      capacity: dayCapacity(onlineSeconds, s.avgSeconds, s.done, trailing),
      utilization: utilization(busySeconds, onlineSeconds),
      avgMinutes: s.avgSeconds === null ? null : s.avgSeconds / 60,
      p90Minutes: s.p90Seconds === null ? null : s.p90Seconds / 60,
      instagram: instagramByDay.get(day) ?? 0,
      spendUsd: spendByDay.get(day) ?? 0,
    }
  })
}

export type BoxRunStats = { done24h: number; done7d: number; busyHoursToday: number }

export function boxRunStats(runs: RenderRun[], box: string, now: Date): BoxRunStats {
  const today = dayKey(now)
  const mine = runs.filter((r) => r.box === box)
  const doneSince = (ms: number) =>
    mine.filter(
      (r) => r.status === 'done' && r.finishedAt && r.finishedAt.getTime() >= now.getTime() - ms,
    ).length
  const busy = busySecondsByBoxDay(mine, [today]).get(box)?.get(today) ?? 0
  return { done24h: doneSince(DAY_MS), done7d: doneSince(7 * DAY_MS), busyHoursToday: busy / 3600 }
}

export function fmtAgo(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '-'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`
}
