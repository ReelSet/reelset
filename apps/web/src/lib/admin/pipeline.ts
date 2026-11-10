export type StepState = 'done' | 'active' | 'pending' | 'failed'
export type Step = { key: string; label: string; state: StepState }

export const STEP_DEFS = [
  { key: 'found', label: 'Found' },
  { key: 'script', label: 'Script' },
  { key: 'embed', label: 'Embed' },
  { key: 'render', label: 'Render' },
  { key: 'live', label: 'Live' },
] as const

// Item status means "this stage finished", so the active step is the one after it.
const COMPLETED_STEPS: Record<string, number> = {
  found: 1,
  summarized: 2,
  embedded: 3,
  voiced: 3,
  rendered: 5,
}

const RESUME_STEP: Record<string, number> = { summarized: 2, embedded: 3, voiced: 3 }

export function stepperFor(status: string, lastOkStage?: string | null): Step[] {
  const failed = status === 'failed' || status === 'insufficient_source'
  const completed = failed
    ? (COMPLETED_STEPS[lastOkStage ?? 'found'] ?? 1)
    : (COMPLETED_STEPS[status] ?? 1)
  const stopped = failed ? Math.min(completed, STEP_DEFS.length - 1) : -1
  return STEP_DEFS.map((def, i) => {
    if (failed) {
      const state: StepState = i < completed ? 'done' : i === stopped ? 'failed' : 'pending'
      return { ...def, state }
    }
    const state: StepState = i < completed ? 'done' : i === completed ? 'active' : 'pending'
    return { ...def, state }
  })
}

export function activeStepKey(status: string): string | null {
  const index = COMPLETED_STEPS[status]
  if (index === undefined || index >= STEP_DEFS.length) return null
  return STEP_DEFS[index]?.key ?? null
}

export function resumeStepFor(status: string): number | null {
  return RESUME_STEP[status] ?? null
}

export const ACTIVE_STATUSES = ['found', 'summarized', 'embedded', 'voiced'] as const

export type StageMedians = Partial<Record<string, number>>

// Item-event stage that measures the active step, mapped to the typical duration of that step.
const STEP_MEDIAN_KEY: Record<string, string> = {
  script: 'summarized',
  embed: 'embedded',
  render: 'render',
}

export type Eta = { kind: 'normal' | 'slow'; label: string } | null

export function etaHint(stepKey: string | null, elapsedMs: number, medians: StageMedians): Eta {
  const median = stepKey ? medians[STEP_MEDIAN_KEY[stepKey] ?? ''] : undefined
  if (!median) return null
  if (elapsedMs > median * 2)
    return { kind: 'slow', label: `running long, usually ~${shortDuration(median)}` }
  const left = Math.max(0, median - elapsedMs)
  return { kind: 'normal', label: left < 5_000 ? 'finishing up' : `~${shortDuration(left)} left` }
}

export function shortDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

export function relativeTime(value: Date | string | null | undefined, now: Date): string {
  if (!value) return '-'
  const diff = now.getTime() - new Date(value).getTime()
  if (Number.isNaN(diff)) return '-'
  if (diff < 0) return 'just now'
  if (diff < 5_000) return 'just now'
  return `${shortDuration(diff)} ago`
}

export type ErrorInfo = { summary: string; hint: string | null }

const ERROR_RULES: { test: RegExp; summary: string; hint: string | null }[] = [
  {
    test: /stuck_timeout|stuck in \w+ after/i,
    summary: 'Took too long and was stopped',
    hint: 'Safe to retry',
  },
  {
    test: /\bbusy\b/i,
    summary: 'Render server was busy',
    hint: 'Retries on its own; retry if it stays failed',
  },
  {
    test: /invalid_input/i,
    summary: 'The renderer rejected this item’s data',
    hint: 'Usually a bad title or script; retrying rarely helps',
  },
  {
    test: /quota|resource_exhausted|billing|\b402\b/i,
    summary: 'Provider quota or credits ran out',
    hint: 'Top up credits, then retry',
  },
  {
    test: /generation rejected/i,
    summary: 'The AI script did not pass checks',
    hint: 'Retry from Found to regenerate the script',
  },
  { test: /tts_unavailable/i, summary: 'Narration voice service failed', hint: 'Safe to retry' },
  {
    test: /container_unreachable/i,
    summary: 'Render server could not be reached',
    hint: 'Safe to retry',
  },
  {
    test: /stale_container_template/i,
    summary: 'Render server is on an older template',
    hint: 'Retry after the deploy settles',
  },
  { test: /ffmpeg_failed/i, summary: 'Video encoding failed', hint: 'Safe to retry' },
  { test: /too_large/i, summary: 'Video came out too large', hint: 'Will not succeed on retry' },
  {
    test: /script_invalid/i,
    summary: 'Stored script is invalid',
    hint: 'Retry from Found to regenerate',
  },
  {
    test: /bad_container_response|upload_failed/i,
    summary: 'Render result could not be saved',
    hint: 'Safe to retry',
  },
  { test: /spam_filtered/i, summary: 'Filtered as spam', hint: null },
]

export function describeError(raw: string | null | undefined): ErrorInfo | null {
  if (!raw) return null
  const rule = ERROR_RULES.find((r) => r.test.test(raw))
  return rule
    ? { summary: rule.summary, hint: rule.hint }
    : { summary: raw.slice(0, 140), hint: null }
}

export type TimelineEvent = {
  stage: string
  outcome: string
  attempt: number
  duration_ms: number | null
  error: string | null
  created_at: Date | string
}

export type TimelineBar = {
  label: string
  outcome: string
  attempt: number
  startMs: number
  durationMs: number
  error: string | null
}

export type Timeline = { bars: TimelineBar[]; totalMs: number; startedAt: string | null }

export function buildTimeline(events: readonly TimelineEvent[]): Timeline {
  const timed = events
    .filter((e) => e.duration_ms !== null && e.duration_ms > 0)
    .map((e) => {
      const end = new Date(e.created_at).getTime()
      return { e, end, start: end - (e.duration_ms ?? 0) }
    })
    .sort((a, b) => a.start - b.start)
  const first = events.length
    ? Math.min(...events.map((e) => new Date(e.created_at).getTime()))
    : null
  if (first === null) return { bars: [], totalMs: 0, startedAt: null }
  const origin = Math.min(first, ...timed.map((t) => t.start))
  const bars = timed.map(({ e, start }) => ({
    label: e.stage,
    outcome: e.outcome,
    attempt: e.attempt,
    startMs: start - origin,
    durationMs: e.duration_ms ?? 0,
    error: e.error,
  }))
  const lastEvent = Math.max(...events.map((ev) => new Date(ev.created_at).getTime()))
  return { bars, totalMs: lastEvent - origin, startedAt: new Date(origin).toISOString() }
}
