import {
  elapsedMs,
  errorFields,
  type Database,
  type IngestMode,
  type Logger,
  type Source,
} from '@reelset/core'
import {
  INGEST_RUN_DEADLINE_MS,
  MODE_HOST_INTERVAL_MS,
  MODE_MAX_PAGES,
  RUN_STUCK_AFTER_MS,
} from '../config'
import { ADAPTERS } from '../registry'
import type { FetchContext, IngestSettings, SourceAdapter, TaskOutcome, Watermark } from '../types'
import { persistMentions } from './persist'
import { planRange, nextWatermark, publishedBounds } from './range'
import { refreshRedditScores } from './reddit-refresh'
import {
  beat,
  finishRun,
  insertTasks,
  loadWatermarks,
  markTaskRunning,
  markTaskSettled,
  saveWatermark,
  startRun,
  sweepStuckRuns,
  watermarkKey,
} from './repo'
import { loadIngestSettings } from './settings'

const MAX_SCOPE_LENGTH = 128

export type PlannedTask = { position: number; adapter: SourceAdapter; scope: string }

export function planTasks(
  adapters: readonly SourceAdapter[],
  settings: IngestSettings,
  only?: readonly Source[],
  log?: Logger,
): PlannedTask[] {
  const tasks: PlannedTask[] = []
  for (const adapter of adapters) {
    if (only && !only.includes(adapter.source)) continue
    const scopes = [...new Set(adapter.scopes(settings))]
    for (const scope of scopes) {
      if (scope.length > MAX_SCOPE_LENGTH) {
        log?.warn({ source: adapter.source, scope: scope.slice(0, 60) }, 'scope too long, skipped')
        continue
      }
      tasks.push({ position: tasks.length, adapter, scope })
    }
  }
  return tasks
}

export type RunEnv = {
  githubToken?: string
  render?: Pick<Fetcher, 'fetch'>
}

export type RunDeps = {
  db: Database
  env: RunEnv
  log: Logger
  adapters?: readonly SourceAdapter[]
  now?: () => Date
}

export type RunSummary = {
  runId: string | null
  mode: IngestMode
  tasks: TaskOutcome[]
  fetched: number
  inserted: number
  updated: number
}

export function taskStatusFor(fetched: number): TaskOutcome['status'] {
  return fetched === 0 ? 'empty' : 'ok'
}

async function runTask(
  deps: RunDeps,
  task: PlannedTask,
  mode: IngestMode,
  watermark: Watermark | null,
  base: Omit<FetchContext, 'range'>,
  log: Logger,
): Promise<TaskOutcome> {
  const startedAt = performance.now()
  const { adapter, scope } = task
  const identity = { source: adapter.source, scope }

  const plan = planRange(adapter, mode, watermark, base.now)
  if (plan.skip) {
    log.info({ reason: plan.reason }, 'ingest task skipped')
    return {
      ...identity,
      status: 'empty',
      fetched: 0,
      inserted: 0,
      updated: 0,
      durationMs: 0,
      error: null,
    }
  }

  log.debug({ after: plan.range.after, before: plan.range.before }, 'ingest task start')
  const outcome = await adapter.fetch(scope, log, { ...base, range: plan.range })
  const counts = await persistMentions(deps.db, outcome.mentions, log, base.now)
  const update = nextWatermark(
    watermark,
    mode,
    publishedBounds(outcome.mentions),
    outcome.exhausted,
  )
  await saveWatermark(deps.db, adapter.source, scope, update)

  return {
    ...identity,
    status: taskStatusFor(outcome.mentions.length),
    fetched: counts.fetched,
    inserted: counts.inserted,
    updated: counts.updated,
    durationMs: elapsedMs(startedAt),
    error: null,
  }
}

export async function runIngest(
  deps: RunDeps,
  options: { mode?: IngestMode; sources?: readonly Source[] } = {},
): Promise<RunSummary> {
  const mode = options.mode ?? 'incremental'
  const now = deps.now?.() ?? new Date()
  const runStartedAt = performance.now()
  const log = deps.log.child({ mod: 'ingest', mode })
  const { db } = deps

  const settings = await loadIngestSettings(db, log)
  const tasks = planTasks(deps.adapters ?? ADAPTERS, settings, options.sources, log)
  const summary: RunSummary = { runId: null, mode, tasks: [], fetched: 0, inserted: 0, updated: 0 }
  if (tasks.length === 0) {
    log.warn('ingest run has no tasks')
    return summary
  }

  try {
    await sweepStuckRuns(db, new Date(now.getTime() - RUN_STUCK_AFTER_MS), log)
  } catch (err) {
    log.warn(errorFields(err), 'stuck run sweep failed, continuing')
  }

  const runId = await startRun(db, mode)
  summary.runId = runId
  const runLog = log.child({ runId })
  await insertTasks(
    db,
    runId,
    tasks.map((t) => ({ position: t.position, source: t.adapter.source, scope: t.scope })),
  )
  runLog.info({ tasks: tasks.length }, 'ingest run start')

  const watermarks = await loadWatermarks(db)
  const deadlineAt = runStartedAt + INGEST_RUN_DEADLINE_MS
  const base: Omit<FetchContext, 'range'> = {
    mode,
    maxPages: MODE_MAX_PAGES[mode],
    hostIntervalMs: MODE_HOST_INTERVAL_MS[mode],
    deadlineAt,
    now,
    githubToken: deps.env.githubToken,
    render: deps.env.render,
    settings,
  }

  const bySource = new Map<Source, PlannedTask[]>()
  for (const task of tasks) {
    const list = bySource.get(task.adapter.source) ?? []
    list.push(task)
    bySource.set(task.adapter.source, list)
  }

  const settle = async (task: PlannedTask, outcome: TaskOutcome) => {
    summary.tasks.push(outcome)
    summary.fetched += outcome.fetched
    summary.inserted += outcome.inserted
    summary.updated += outcome.updated
    await markTaskSettled(db, runId, task.position, outcome)
    await beat(db, runId)
  }

  try {
    await Promise.all(
      [...bySource.values()].map(async (group) => {
        for (const task of group) {
          const taskLog = runLog.child({ source: task.adapter.source, scope: task.scope })
          const startedAt = performance.now()
          await markTaskRunning(db, runId, task.position)
          try {
            const watermark = watermarks.get(watermarkKey(task.adapter.source, task.scope)) ?? null
            const outcome = await runTask(deps, task, mode, watermark, base, taskLog)
            taskLog.info(
              { status: outcome.status, fetched: outcome.fetched, inserted: outcome.inserted },
              'ingest task done',
            )
            await settle(task, outcome)
          } catch (err) {
            taskLog.error(errorFields(err), 'ingest task failed')
            await settle(task, {
              source: task.adapter.source,
              scope: task.scope,
              status: 'failed',
              fetched: 0,
              inserted: 0,
              updated: 0,
              durationMs: elapsedMs(startedAt),
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      }),
    )

    if (bySource.has('reddit')) {
      try {
        await refreshRedditScores(db, runLog, now, deadlineAt)
      } catch (err) {
        runLog.warn(errorFields(err), 'reddit score refresh failed, run continues')
      }
    }

    const succeeded = summary.tasks.some((t) => t.status === 'ok' || t.status === 'empty')
    await finishRun(db, runId, succeeded ? 'done' : 'failed', summary)
    runLog.info(
      {
        tasks: summary.tasks.length,
        fetched: summary.fetched,
        inserted: summary.inserted,
        durationMs: elapsedMs(runStartedAt),
      },
      'ingest run complete',
    )
    return summary
  } catch (err) {
    runLog.error(errorFields(err), 'ingest run aborted')
    await finishRun(db, runId, 'failed', summary)
    throw err
  }
}
