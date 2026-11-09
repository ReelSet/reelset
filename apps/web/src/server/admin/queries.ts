import {
  IngestTaskStatus,
  ItemStatus,
  RenderStatus,
  SETTINGS,
  Source,
  getSetting,
  type AskOutcome,
  type Database,
  type Logger,
  type SettingDef,
} from '@reelset/core'
import { sql } from 'kysely'
import {
  TTS_ERROR_CODE,
  parseAlertLastSent,
  successRate,
  transcriptStats,
  YOUTUBE_ALERT_KEY,
} from '@/lib/admin/health'
import { DISCARD_META_KEY } from '@/lib/admin/retry'
import { sliceWithMore, type PageRequest } from '@/lib/admin/pagination'
import { lastDays, pivotSpend, type SpendRow } from '@/lib/admin/spend'

export const STUCK_MINUTES = 30
export const SPEND_DAYS = 14

const iso = (value: Date | string) => new Date(value).toISOString()

export async function statusCounts(db: Database) {
  const rows = await db
    .selectFrom('item')
    .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('status')
    .execute()
  const counts = new Map(rows.map((r) => [r.status, Number(r.n)]))
  return Object.values(ItemStatus).map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

const itemSource = sql<string>`coalesce(
  (select m.source::text from mention m where m.item_id = item.id order by m.score desc nulls last limit 1),
  case when split_part(item.canonical_key, ':', 1) in ('hn', 'github', 'news', 'reddit', 'youtube')
    then split_part(item.canonical_key, ':', 1) else 'unknown' end
)`

export async function sourceStatusMatrix(db: Database) {
  const rows = await db
    .selectFrom('item')
    .select([itemSource.as('source'), 'status', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy([itemSource, 'status'])
    .execute()
  return rows.map((r) => ({ source: r.source, status: r.status, count: Number(r.n) }))
}

export type ItemFilters = { source: string | null; status: ItemStatus | null; q: string | null }

export async function listItems(db: Database, page: PageRequest, filters: ItemFilters) {
  let query = db
    .selectFrom('item')
    .select([
      'id',
      'title',
      'status',
      'kind',
      'score',
      'attempts',
      'last_error',
      'published_at',
      'status_changed_at',
      itemSource.as('source'),
    ])
  if (filters.status) query = query.where('status', '=', filters.status)
  if (filters.source) query = query.where(sql<boolean>`${itemSource} = ${filters.source}`)
  if (filters.q) query = query.where('title', 'ilike', `%${filters.q.replace(/[%_]/g, '')}%`)
  const rows = await query
    .orderBy('status_changed_at', 'desc')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  return sliceWithMore(rows, page.pageSize)
}

export async function stuckItems(db: Database) {
  return db
    .selectFrom('item')
    .select(['id', 'title', 'status', 'attempts', 'queued_at', 'status_changed_at', 'last_error'])
    .where('status', 'in', [ItemStatus.found, ItemStatus.summarized, ItemStatus.embedded])
    .where('queued_at', 'is not', null)
    .where(sql<boolean>`queued_at < now() - make_interval(mins => ${STUCK_MINUTES})`)
    .orderBy('queued_at', 'asc')
    .limit(50)
    .execute()
}

export async function failedItems(db: Database, page: PageRequest) {
  const rows = await db
    .selectFrom('item')
    .select((eb) => [
      'id',
      'title',
      'attempts',
      'last_error',
      'status_changed_at',
      eb
        .selectFrom('item_event')
        .select('item_event.stage')
        .whereRef('item_event.item_id', '=', 'item.id')
        .where('item_event.outcome', '=', 'ok')
        .where('item_event.stage', '!=', ItemStatus.failed)
        .orderBy('item_event.created_at', 'desc')
        .orderBy('item_event.id', 'desc')
        .limit(1)
        .as('last_ok_stage'),
    ])
    .where('status', '=', ItemStatus.failed)
    .where(
      sql<boolean>`not exists (
        select 1 from item_event d
        where d.item_id = item.id
          and d.stage = 'failed'
          and d.outcome = 'skipped'
          and d.meta ->> ${DISCARD_META_KEY} = 'true'
          and d.created_at >= item.status_changed_at
      )`,
    )
    .orderBy('status_changed_at', 'desc')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  return sliceWithMore(rows, page.pageSize)
}

export async function itemTimeline(db: Database, itemId: string) {
  const item = await db
    .selectFrom('item')
    .select(['id', 'title', 'status', 'attempts', 'last_error', 'queued_at', 'canonical_url'])
    .where('id', '=', itemId)
    .executeTakeFirst()
  if (!item) return null
  const events = await db
    .selectFrom('item_event')
    .select(['id', 'stage', 'outcome', 'attempt', 'duration_ms', 'error', 'meta', 'created_at'])
    .where('item_id', '=', itemId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(200)
    .execute()
  return { item, events }
}

export async function ingestRuns(db: Database, page: PageRequest) {
  const rows = await db
    .selectFrom('ingest_run')
    .select((eb) => [
      'id',
      'mode',
      'status',
      'started_at',
      'finished_at',
      eb
        .selectFrom('ingest_task')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('ingest_task.run_id', '=', 'ingest_run.id')
        .as('task_count'),
      eb
        .selectFrom('ingest_task')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('ingest_task.run_id', '=', 'ingest_run.id')
        .where('ingest_task.status', '=', IngestTaskStatus.failed)
        .as('failed_count'),
    ])
    .orderBy('started_at', 'desc')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  return sliceWithMore(rows, page.pageSize)
}

export async function ingestTasks(db: Database, runId: string) {
  return db
    .selectFrom('ingest_task')
    .select([
      'id',
      'position',
      'source',
      'scope',
      'status',
      'fetched',
      'inserted',
      'updated',
      'duration_ms',
      'error',
      'finished_at',
    ])
    .where('run_id', '=', runId)
    .orderBy('position', 'asc')
    .execute()
}

export async function latestRunId(db: Database): Promise<string | null> {
  const row = await db
    .selectFrom('ingest_run')
    .select('id')
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row?.id ?? null
}

export async function renderRows(db: Database, page: PageRequest, status: RenderStatus | null) {
  let query = db
    .selectFrom('render')
    .innerJoin('item', 'item.id', 'render.item_id')
    .select([
      'render.id',
      'render.item_id',
      'item.title',
      'item.status as item_status',
      'render.status',
      'render.attempts',
      'render.render_ms',
      'render.bytes',
      'render.video_duration_ms',
      'render.video_key',
      'render.error',
      'render.created_at',
    ])
  if (status) query = query.where('render.status', '=', status)
  const rows = await query
    .orderBy('render.created_at', 'desc')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  return sliceWithMore(rows, page.pageSize)
}

export async function sourceHealth(db: Database) {
  const tasks = await db
    .selectFrom('ingest_task')
    .select((eb) => [
      'source',
      sql<Date | null>`max(finished_at) filter (where status in ('ok', 'empty'))`.as('last_ok_at'),
      sql<Date | null>`max(finished_at) filter (where status = 'failed')`.as('last_failed_at'),
      eb.fn.countAll<string>().as('tasks_24h'),
    ])
    .where(sql<boolean>`coalesce(started_at, finished_at) > now() - interval '24 hours'`)
    .groupBy('source')
    .execute()
  const lastErrors = await db
    .selectFrom('ingest_task')
    .select(['source', 'error'])
    .distinctOn('source')
    .where('status', '=', IngestTaskStatus.failed)
    .orderBy('source')
    .orderBy('finished_at', 'desc')
    .execute()
  const errorBySource = new Map(lastErrors.map((r) => [r.source, r.error]))

  const watermarks = await db
    .selectFrom('source_watermark')
    .select([
      'source',
      'scope',
      'lane',
      'newest_at',
      'oldest_at',
      'backfill_complete',
      'updated_at',
    ])
    .orderBy('source')
    .orderBy('scope')
    .execute()

  return {
    sources: tasks.map((t) => ({
      source: t.source,
      lastOkAt: t.last_ok_at ? iso(t.last_ok_at) : null,
      lastFailedAt: t.last_failed_at ? iso(t.last_failed_at) : null,
      tasks24h: Number(t.tasks_24h),
      lastError: errorBySource.get(t.source) ?? null,
    })),
    watermarks,
  }
}

export async function youtubeDiscovery(db: Database) {
  const [task, alert] = await Promise.all([
    db
      .selectFrom('ingest_task')
      .select(['status', 'fetched', 'error', 'started_at', 'finished_at'])
      .where('source', '=', Source.youtube)
      .orderBy(sql`coalesce(finished_at, started_at)`, 'desc')
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom('app_setting')
      .select('value')
      .where('key', '=', YOUTUBE_ALERT_KEY)
      .executeTakeFirst(),
  ])
  const at = task?.finished_at ?? task?.started_at ?? null
  return {
    status: task?.status ?? null,
    at: at ? iso(at) : null,
    fetched: task?.fetched ?? null,
    error: task?.error ?? null,
    alertLastSentAt: parseAlertLastSent(alert?.value),
  }
}

export async function transcriptHealth(db: Database) {
  const rows = await db
    .selectFrom('item_event')
    .innerJoin('item', 'item.id', 'item_event.item_id')
    .select('item_event.stage')
    .where('item.canonical_key', 'like', 'youtube:%')
    .where('item_event.stage', 'in', [ItemStatus.summarized, ItemStatus.insufficient_source])
    .orderBy('item_event.created_at', 'desc')
    .limit(20)
    .execute()
  return transcriptStats(
    rows.map((r) => (r.stage === ItemStatus.summarized ? 'ok' : 'unavailable')),
  )
}

export async function renderFailureLastHour(db: Database) {
  const row = await db
    .selectFrom('render')
    .select((eb) => [
      eb.fn.countAll<string>().as('total'),
      sql<string>`count(*) filter (where status = ${RenderStatus.failed})`.as('failed'),
    ])
    .where('status', 'in', [RenderStatus.done, RenderStatus.failed])
    .where(sql<boolean>`coalesce(finished_at, created_at) > now() - interval '1 hour'`)
    .executeTakeFirstOrThrow()
  const total = Number(row.total)
  const failed = Number(row.failed)
  return { total, failed, rate: successRate(failed, total) }
}

export const TTS_WINDOW_HOURS = 24

export async function ttsFailureRecent(db: Database) {
  const row = await db
    .selectFrom('render')
    .select((eb) => [
      eb.fn.countAll<string>().as('total'),
      sql<string>`count(*) filter (where status = ${RenderStatus.failed} and error = ${TTS_ERROR_CODE})`.as(
        'tts_failed',
      ),
    ])
    .where('status', 'in', [RenderStatus.done, RenderStatus.failed])
    .where(
      sql<boolean>`coalesce(finished_at, created_at) > now() - make_interval(hours => ${TTS_WINDOW_HOURS})`,
    )
    .executeTakeFirstOrThrow()
  const total = Number(row.total)
  const failed = Number(row.tts_failed)
  return { total, failed, rate: successRate(failed, total) }
}

export async function spendLedger(db: Database, now = new Date()) {
  const days = lastDays(SPEND_DAYS, now)
  const rows = await db
    .selectFrom('spend_ledger')
    .select([
      sql<string>`day::text`.as('day'),
      'category',
      sql<string>`sum(cost_usd)`.as('cost'),
      sql<string>`sum(units)`.as('units'),
    ])
    .where('day', '>=', sql<Date>`${days[days.length - 1]}::date`)
    .groupBy(['day', 'category'])
    .execute()
  const spendRows: SpendRow[] = rows.map((r) => ({
    day: r.day,
    category: r.category,
    costUsd: Number(r.cost),
    units: Number(r.units),
  }))
  return pivotSpend(spendRows, days)
}

export async function askLog(db: Database, page: PageRequest, outcome: AskOutcome | null) {
  let query = db
    .selectFrom('ask_query')
    .select([
      'id',
      'question',
      'outcome',
      'latency_ms',
      'citations',
      'answer',
      'input_tokens',
      'output_tokens',
      'created_at',
    ])
  if (outcome) query = query.where('outcome', '=', outcome)
  const rows = await query
    .orderBy('created_at', 'desc')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  return sliceWithMore(rows, page.pageSize)
}

export async function currentSettings(db: Database, log: Logger) {
  const defs: SettingDef<unknown>[] = Object.values(SETTINGS)
  const entries = await Promise.all(
    defs.map(async (def) => [def.key, await getSetting(db, def, log)] as const),
  )
  return new Map<string, unknown>(entries)
}
