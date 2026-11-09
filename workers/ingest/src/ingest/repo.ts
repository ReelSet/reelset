import { sql } from 'kysely'
import type {
  Database,
  IngestMode,
  IngestRunStatus,
  Logger,
  Source,
  WatermarkLane,
} from '@reelset/core'
import type { Watermark, TaskOutcome } from '../types'
import type { WatermarkUpdate } from './range'

export const watermarkKey = (source: Source, scope: string): string => `${source}\u0000${scope}`

export async function loadWatermarks(db: Database): Promise<Map<string, Watermark>> {
  const rows = await db
    .selectFrom('source_watermark')
    .selectAll()
    .where('lane', '=', 'default')
    .execute()
  return new Map(
    rows.map((row) => [
      watermarkKey(row.source, row.scope),
      {
        source: row.source,
        scope: row.scope,
        lane: row.lane as WatermarkLane,
        newestAt: row.newest_at ? new Date(row.newest_at) : null,
        oldestAt: row.oldest_at ? new Date(row.oldest_at) : null,
        nextToken: row.next_token,
        backfillComplete: row.backfill_complete,
      },
    ]),
  )
}

export async function saveWatermark(
  db: Database,
  source: Source,
  scope: string,
  update: WatermarkUpdate,
): Promise<void> {
  await db
    .insertInto('source_watermark')
    .values({
      source,
      scope,
      lane: 'default',
      newest_at: update.newestAt,
      oldest_at: update.oldestAt,
      backfill_complete: update.backfillComplete,
    })
    .onConflict((oc) =>
      oc.columns(['source', 'scope', 'lane']).doUpdateSet({
        newest_at: update.newestAt,
        oldest_at: update.oldestAt,
        backfill_complete: update.backfillComplete,
        updated_at: sql`now()`,
      }),
    )
    .execute()
}

export async function startRun(db: Database, mode: IngestMode): Promise<string> {
  const row = await db
    .insertInto('ingest_run')
    .values({ mode })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

export async function insertTasks(
  db: Database,
  runId: string,
  tasks: readonly { position: number; source: Source; scope: string }[],
): Promise<void> {
  if (tasks.length === 0) return
  await db
    .insertInto('ingest_task')
    .values(
      tasks.map((t) => ({ run_id: runId, position: t.position, source: t.source, scope: t.scope })),
    )
    .execute()
}

export async function markTaskRunning(db: Database, runId: string, position: number) {
  await db
    .updateTable('ingest_task')
    .set({ status: 'running', started_at: sql`now()` })
    .where('run_id', '=', runId)
    .where('position', '=', position)
    .execute()
}

export async function markTaskSettled(
  db: Database,
  runId: string,
  position: number,
  outcome: TaskOutcome,
) {
  await db
    .updateTable('ingest_task')
    .set({
      status: outcome.status,
      fetched: outcome.fetched,
      inserted: outcome.inserted,
      updated: outcome.updated,
      duration_ms: outcome.durationMs,
      error: outcome.error?.slice(0, 1000) ?? null,
      finished_at: sql`now()`,
    })
    .where('run_id', '=', runId)
    .where('position', '=', position)
    .execute()
}

export async function beat(db: Database, runId: string) {
  await db
    .updateTable('ingest_run')
    .set({ heartbeat_at: sql`now()` })
    .where('id', '=', runId)
    .execute()
}

export async function finishRun(
  db: Database,
  runId: string,
  status: IngestRunStatus,
  result: unknown,
) {
  await db
    .updateTable('ingest_run')
    .set({ status, finished_at: sql`now()`, result: JSON.stringify(result) })
    .where('id', '=', runId)
    .execute()
}

export async function hasAnyWatermark(db: Database): Promise<boolean> {
  const row = await db.selectFrom('source_watermark').select('source').limit(1).executeTakeFirst()
  return row !== undefined
}

/**
 * A worker killed mid-run never reaches finishRun. Runs whose heartbeat is older than the cutoff
 * are closed as failed, and their unfinished tasks too, so the dashboard and alerts do not show
 * them as running forever.
 */
export async function sweepStuckRuns(
  db: Database,
  cutoff: Date,
  log: Logger,
): Promise<{ runs: number; tasks: number }> {
  const run = async (trx: Database) => {
    const runs = await trx
      .updateTable('ingest_run')
      .set({ status: 'failed', finished_at: sql`now()` })
      .where('status', '=', 'running')
      .where('heartbeat_at', '<', cutoff)
      .returning('id')
      .execute()
    if (runs.length === 0) return { runs: 0, tasks: 0 }
    const tasks = await trx
      .updateTable('ingest_task')
      .set({
        status: 'failed',
        error: 'run abandoned (worker stopped before finishing)',
        finished_at: sql`now()`,
      })
      .where(
        'run_id',
        'in',
        runs.map((r) => r.id),
      )
      .where('status', 'in', ['queued', 'running'])
      .executeTakeFirst()
    const swept = { runs: runs.length, tasks: Number(tasks.numUpdatedRows) }
    log.warn({ ...swept, runIds: runs.map((r) => r.id) }, 'swept stuck ingest runs')
    return swept
  }
  return db.isTransaction ? run(db) : db.transaction().execute(run)
}
