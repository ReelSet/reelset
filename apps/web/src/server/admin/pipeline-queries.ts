import {
  ItemStatus,
  RenderStatus,
  SETTINGS,
  Source,
  getPipelinePause,
  getSetting,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql, type RawBuilder } from 'kysely'
import { ACTIVE_STATUSES, type StageMedians } from '@/lib/admin/pipeline'
import { sliceWithMore, type PageRequest } from '@/lib/admin/pagination'
import type { RecentFilters } from '@/lib/admin/recent-filters'

export const IN_PROGRESS_LIMIT = 40
export const PIPELINE_SPEND_CATEGORIES = ['llm', 'embedding', 'tts', 'render'] as const
const MEDIAN_WINDOW_DAYS = 7

const sourceList = sql.raw(
  Object.values(Source)
    .map((s) => `'${s}'`)
    .join(', '),
)

const itemSource = sql<string>`coalesce(
  (select m.source::text from mention m where m.item_id = item.id order by m.score desc nulls last limit 1),
  case when split_part(item.canonical_key, ':', 1) in (${sourceList})
    then split_part(item.canonical_key, ':', 1) else 'unknown' end
)`

const thumbnail = sql<string | null>`(item.images -> 0 ->> 'url')`

const latestRender = (column: string): RawBuilder<unknown> =>
  sql`(select r.${sql.raw(column)} from render r where r.item_id = item.id order by r.created_at desc limit 1)`

export async function healthSnapshot(db: Database, log: Logger) {
  const [
    pause,
    spendRows,
    dailyCap,
    spendCap,
    admitted,
    queue,
    inFlight,
    hour,
    lastDone,
    llm,
    ttsProvider,
    speaker,
  ] = await Promise.all([
    getPipelinePause(db, log),
    db
      .selectFrom('spend_ledger')
      .select(['category', sql<string>`sum(cost_usd)`.as('cost')])
      .where('day', '=', sql<Date>`(now() at time zone 'utc')::date`)
      .where('category', 'in', [...PIPELINE_SPEND_CATEGORIES])
      .groupBy('category')
      .execute(),
    getSetting(db, SETTINGS.dailyReelCap, log),
    getSetting(db, SETTINGS.pipelineDailySpendCapUsd, log),
    admittedToday(db),
    db
      .selectFrom('item')
      .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
      .where('status', 'in', [...ACTIVE_STATUSES])
      .where(sql<boolean>`(status <> 'found' or queued_at is not null)`)
      .groupBy('status')
      .execute(),
    db
      .selectFrom('render')
      .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
      .where('status', 'in', [RenderStatus.queued, RenderStatus.rendering])
      // Leftover rows of items that already finished or failed are not work in flight.
      .where(
        sql<boolean>`exists (select 1 from item i where i.id = render.item_id and i.status = 'embedded')`,
      )
      .groupBy('status')
      .execute(),
    db
      .selectFrom('render')
      .select((eb) => [
        eb.fn.countAll<string>().as('total'),
        sql<string>`count(*) filter (where status = 'failed')`.as('failed'),
      ])
      .where('status', 'in', [RenderStatus.done, RenderStatus.failed])
      .where(sql<boolean>`coalesce(finished_at, created_at) > now() - interval '1 hour'`)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('render')
      .select([
        sql<Date | null>`max(finished_at)`.as('at'),
        sql<number | null>`max(template_version)`.as('template'),
      ])
      .where('status', '=', RenderStatus.done)
      .executeTakeFirst(),
    db
      .selectFrom('spend_ledger')
      .select([
        sql<string | null>`meta ->> 'provider'`.as('provider'),
        sql<string | null>`meta ->> 'model'`.as('model'),
      ])
      .where('category', '=', 'llm')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst(),
    getSetting(db, SETTINGS.ttsProvider, log),
    getSetting(db, SETTINGS.ttsAuraSpeaker, log),
  ])

  const spendByCategory = new Map(spendRows.map((r) => [r.category as string, Number(r.cost)]))
  const flight = new Map(inFlight.map((r) => [r.status, Number(r.n)]))
  const failed = Number(hour.failed)
  const total = Number(hour.total)
  return {
    pause,
    spend: PIPELINE_SPEND_CATEGORIES.map((c) => ({
      category: c,
      usd: spendByCategory.get(c) ?? 0,
    })),
    spendCapUsd: spendCap,
    dailyCap,
    admittedToday: admitted,
    queue: queue.map((r) => ({ status: r.status, count: Number(r.n) })),
    rendering: flight.get(RenderStatus.rendering) ?? 0,
    renderQueued: flight.get(RenderStatus.queued) ?? 0,
    failureLastHour: { failed, total, rate: total > 0 ? failed / total : null },
    lastRenderAt: lastDone?.at ? new Date(lastDone.at).toISOString() : null,
    templateVersion: lastDone?.template ?? null,
    llm: llm ? { provider: llm.provider, model: llm.model } : null,
    tts: { provider: ttsProvider, speaker: ttsProvider === 'aura2' ? speaker : null },
  }
}

export type HealthSnapshot = Awaited<ReturnType<typeof healthSnapshot>>

// Mirrors the ingest reconciler's admission count so the daily cap reads the same here.
async function admittedToday(db: Database): Promise<number> {
  const row = await db
    .selectFrom('item_event')
    .innerJoin('item', 'item.id', 'item_event.item_id')
    .select(sql<string>`count(distinct item_event.item_id)`.as('n'))
    .where('item_event.stage', '=', 'found')
    .where('item_event.outcome', '=', 'started')
    .where(sql`item_event.meta->>'admitted'`, '=', 'true')
    .where(
      'item_event.created_at',
      '>=',
      sql<Date>`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    )
    .where('item.status', 'not in', ['failed', 'insufficient_source'])
    .where((eb) =>
      eb.not(eb.and([eb('item.status', '=', 'found'), eb('item.queued_at', 'is', null)])),
    )
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

export async function stageMedians(db: Database): Promise<StageMedians> {
  const [events, renders] = await Promise.all([
    db
      .selectFrom('item_event')
      .select([
        'stage',
        sql<number | null>`percentile_cont(0.5) within group (order by duration_ms)`.as('median'),
      ])
      .where('outcome', '=', 'ok')
      .where('stage', 'in', [ItemStatus.summarized, ItemStatus.embedded])
      .where('duration_ms', 'is not', null)
      .where(sql<boolean>`created_at > now() - make_interval(days => ${MEDIAN_WINDOW_DAYS})`)
      .groupBy('stage')
      .execute(),
    db
      .selectFrom('render')
      .select(
        sql<number | null>`percentile_cont(0.5) within group (order by render_ms)`.as('median'),
      )
      .where('status', '=', RenderStatus.done)
      .where('render_ms', 'is not', null)
      .where(sql<boolean>`created_at > now() - make_interval(days => ${MEDIAN_WINDOW_DAYS})`)
      .executeTakeFirst(),
  ])
  const out: StageMedians = {}
  for (const e of events) if (e.median) out[e.stage] = Number(e.median)
  if (renders?.median) out.render = Number(renders.median)
  return out
}

const lastOkStage = sql<
  string | null
>`(select e.stage::text from item_event e where e.item_id = item.id
  and e.outcome = 'ok' and e.stage <> 'failed' order by e.created_at desc, e.id desc limit 1)`

const ROW_COLUMNS = [
  'item.id',
  'item.title',
  'item.status',
  'item.attempts',
  'item.last_error',
  'item.queued_at',
  'item.status_changed_at',
  'item.first_seen_at',
] as const

export async function inProgressItems(db: Database) {
  return db
    .selectFrom('item')
    .select([
      ...ROW_COLUMNS,
      itemSource.as('source'),
      thumbnail.as('thumbnail'),
      sql<string | null>`${latestRender('status')}`.as('render_status'),
      sql<Date | null>`${latestRender('started_at')}`.as('render_started_at'),
      sql<number | null>`${latestRender('attempts')}`.as('render_attempts'),
    ])
    .where('item.status', 'in', [...ACTIVE_STATUSES])
    .where(sql<boolean>`(item.status <> 'found' or item.queued_at is not null)`)
    .orderBy('item.status_changed_at', 'desc')
    .limit(IN_PROGRESS_LIMIT)
    .execute()
}

export async function recentItems(db: Database, filters: RecentFilters, page: PageRequest) {
  let query = db
    .selectFrom('item')
    .select([
      ...ROW_COLUMNS,
      itemSource.as('source'),
      thumbnail.as('thumbnail'),
      lastOkStage.as('last_ok_stage'),
      sql<string | null>`${latestRender('poster_key')}`.as('poster_key'),
      sql<number | null>`${latestRender('render_ms')}`.as('render_ms'),
    ])
    .where(sql<boolean>`(item.status <> 'found' or item.queued_at is not null)`)
  if (filters.statuses.length) query = query.where('item.status', 'in', filters.statuses)
  if (filters.source) query = query.where(sql<boolean>`${itemSource} = ${filters.source}`)
  if (filters.sinceMs) {
    query = query.where(
      sql<boolean>`item.status_changed_at > now() - make_interval(secs => ${filters.sinceMs / 1000})`,
    )
  }
  if (filters.q) query = query.where('item.title', 'ilike', `%${filters.q.replace(/[%_\\]/g, '')}%`)
  const rows = await query
    .orderBy('item.status_changed_at', 'desc')
    .orderBy('item.id')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  return sliceWithMore(rows, page.pageSize)
}

export async function itemDetail(db: Database, itemId: string) {
  const item = await db
    .selectFrom('item')
    .select([
      ...ROW_COLUMNS,
      'item.tldr',
      'item.script',
      'item.canonical_url',
      'item.topics',
      'item.score',
      'item.published_at',
      'item.rendered_at',
      itemSource.as('source'),
      thumbnail.as('thumbnail'),
      lastOkStage.as('last_ok_stage'),
    ])
    .where('item.id', '=', itemId)
    .executeTakeFirst()
  if (!item) return null
  const [events, renders] = await Promise.all([
    db
      .selectFrom('item_event')
      .select(['id', 'stage', 'outcome', 'attempt', 'duration_ms', 'error', 'meta', 'created_at'])
      .where('item_id', '=', itemId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(300)
      .execute(),
    db
      .selectFrom('render')
      .select([
        'id',
        'render_key',
        'status',
        'attempts',
        'render_ms',
        'bytes',
        'video_duration_ms',
        'video_key',
        'poster_key',
        'template_version',
        'credits',
        'error',
        'created_at',
        'started_at',
        'finished_at',
      ])
      .where('item_id', '=', itemId)
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute(),
  ])
  const renderKeys = renders.map((r) => r.render_key)
  const spend = await db
    .selectFrom('spend_ledger')
    .select(['category', 'cost_usd', 'units', 'meta', 'created_at'])
    .where(
      sql<boolean>`(meta ->> 'itemId' = ${itemId} ${
        renderKeys.length ? sql`or meta ->> 'renderKey' in (${sql.join(renderKeys)})` : sql``
      })`,
    )
    .orderBy('id', 'asc')
    .execute()
  return { item, events, renders, spend }
}

export type ItemDetail = NonNullable<Awaited<ReturnType<typeof itemDetail>>>
