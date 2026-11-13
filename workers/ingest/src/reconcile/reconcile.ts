import { sql } from 'kysely'
import {
  SETTINGS,
  StaleTransitionError,
  errorFields,
  getPipelinePause,
  getSetting,
  recordItemEvent,
  spendTodayUsd,
  transitionItem,
  type Database,
  type ItemStatus,
  type Logger,
} from '@reelset/core'
import {
  ADMISSION_CANDIDATES,
  ENQUEUE_CHUNK,
  RECONCILE_BATCH,
  SPEND_CATEGORIES_FOR_CAP,
  STUCK_AFTER_MS,
} from '../config'
import type { IngestItemMessage, RenderJobMessage } from '../env'
import {
  admissionDecision,
  chunked,
  classifyStuck,
  interleaveBySource,
  utcDayStart,
} from './policy'
import { probePause } from '../pipeline/quota'
import { primarySource, type ScoreSignal } from '../score'

type BatchSender<T> = { sendBatch: (messages: { body: T }[]) => Promise<unknown> }

export type ReconcileQueues = {
  ingest: BatchSender<IngestItemMessage>
  render: BatchSender<RenderJobMessage>
}

export type ReconcileOptions = {
  probe?: () => Promise<unknown>
  alertWebhookUrl?: string
}

export type ReconcileResult = {
  paused: boolean
  stuckRequeued: number
  stuckFailed: number
  admitted: number
  skipped: Record<'below_score' | 'daily_cap' | 'spend_cap', number>
  enqueuedSummarized: number
  enqueuedEmbedded: number
  enqueuedVoiced: number
  spendCapReached: boolean
}

type Claimed = { id: string; attempts: number }

async function claim(db: Database, status: ItemStatus, ids: readonly string[]): Promise<Claimed[]> {
  if (ids.length === 0) return []
  const rows = await db
    .updateTable('item')
    .set({ queued_at: sql`now()` })
    .where('id', 'in', ids)
    .where('status', '=', status)
    .where('queued_at', 'is', null)
    .returning(['id', 'attempts'])
    .execute()
  return rows
}

async function release(db: Database, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await db.updateTable('item').set({ queued_at: null }).where('id', 'in', ids).execute()
}

async function sendClaimed(
  db: Database,
  queue: BatchSender<{ itemId: string; attempt: number }>,
  claimed: readonly Claimed[],
  log: Logger,
): Promise<number> {
  let sent = 0
  for (const batch of chunked(claimed, ENQUEUE_CHUNK)) {
    try {
      await queue.sendBatch(batch.map((c) => ({ body: { itemId: c.id, attempt: c.attempts } })))
      sent += batch.length
    } catch (err) {
      log.error({ count: batch.length, ...errorFields(err) }, 'queue send failed, releasing claim')
      await release(
        db,
        batch.map((c) => c.id),
      )
    }
  }
  return sent
}

async function reconcileStuck(db: Database, now: Date, log: Logger) {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS)
  const rows = await db
    .selectFrom('item')
    .select(['id', 'status', 'queued_at', 'status_changed_at', 'attempts'])
    .where('status', 'in', ['found', 'summarized', 'embedded', 'voiced'])
    .where('queued_at', '<', cutoff)
    .where('status_changed_at', '<', cutoff)
    // A queued or rendering render means the item is waiting its turn on a render box, not stuck.
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('render')
            .select('render.id')
            .whereRef('render.item_id', '=', 'item.id')
            .where('render.status', 'in', ['queued', 'rendering']),
        ),
      ),
    )
    .limit(RECONCILE_BATCH)
    .execute()

  let requeued = 0
  let failed = 0
  for (const row of rows) {
    const l = log.child({ itemId: row.id, status: row.status })
    const decision = classifyStuck(
      {
        status: row.status,
        queuedAt: row.queued_at ? new Date(row.queued_at) : null,
        statusChangedAt: new Date(row.status_changed_at),
        attempts: row.attempts,
      },
      now,
    )
    if (decision === 'requeue') {
      const res = await db
        .updateTable('item')
        .set({ queued_at: null, attempts: sql`attempts + 1` })
        .where('id', '=', row.id)
        .where('status', '=', row.status)
        .where('queued_at', '<', cutoff)
        .executeTakeFirst()
      if (Number(res.numUpdatedRows) > 0) {
        requeued++
        l.warn({ attempts: row.attempts + 1 }, 'stuck item reset for requeue')
      }
    } else if (decision === 'fail') {
      try {
        await transitionItem(
          db,
          {
            itemId: row.id,
            from: row.status,
            to: 'failed',
            attempt: row.attempts + 1,
            error: `stuck in ${row.status} after ${row.attempts + 1} attempts`,
          },
          l,
        )
        failed++
      } catch (err) {
        if (!(err instanceof StaleTransitionError)) throw err
        l.info('stuck item moved on before it could be failed')
      }
    }
  }
  return { requeued, failed }
}

async function enqueueStage(
  db: Database,
  queue: BatchSender<{ itemId: string; attempt: number }>,
  status: 'summarized' | 'embedded' | 'voiced',
  log: Logger,
  limit = RECONCILE_BATCH,
): Promise<number> {
  if (limit <= 0) return 0
  const rows = await db
    .selectFrom('item')
    .select('id')
    .where('status', '=', status)
    .where('queued_at', 'is', null)
    .orderBy('score', 'desc')
    .limit(Math.min(limit, RECONCILE_BATCH))
    .execute()
  const claimed = await claim(
    db,
    status,
    rows.map((r) => r.id),
  )
  const sent = await sendClaimed(db, queue, claimed, log)
  if (sent > 0) log.info({ status, sent }, 'items enqueued')
  return sent
}

async function renderBudget(db: Database, log: Logger): Promise<number> {
  const maxInFlight = await getSetting(db, SETTINGS.renderMaxInFlight, log)
  const row = await db
    .selectFrom('item')
    .select(sql<string>`count(*)`.as('n'))
    .where('status', 'in', ['embedded', 'voiced'])
    .where('queued_at', 'is not', null)
    .executeTakeFirst()
  const inFlight = Number(row?.n ?? 0)
  log.info({ inFlight, maxInFlight }, 'render budget')
  return Math.max(0, maxInFlight - inFlight)
}

async function countAdmittedToday(db: Database, now: Date): Promise<number> {
  const row = await db
    .selectFrom('item_event')
    .innerJoin('item', 'item.id', 'item_event.item_id')
    .select(sql<string>`count(distinct item_event.item_id)`.as('n'))
    .where('item_event.stage', '=', 'found')
    .where('item_event.outcome', '=', 'started')
    .where(sql`item_event.meta->>'admitted'`, '=', 'true')
    .where('item_event.created_at', '>=', utcDayStart(now))
    // Items that failed or had too little source text never become a reel, so they must not eat the cap.
    .where('item.status', 'not in', ['failed', 'insufficient_source'])
    // Released or requeued items (found, not queued) are candidates again, not spent slots.
    .where((eb) =>
      eb.not(eb.and([eb('item.status', '=', 'found'), eb('item.queued_at', 'is', null)])),
    )
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

async function admittedTodayBySource(db: Database, now: Date): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('item_event')
    .innerJoin('item', 'item.id', 'item_event.item_id')
    .select([
      sql<string>`coalesce(item_event.meta->>'source', (select m.source::text from mention m where m.item_id = item.id order by m.published_at limit 1))`.as(
        'source',
      ),
      sql<string>`count(distinct item_event.item_id)`.as('n'),
    ])
    .where('item_event.stage', '=', 'found')
    .where('item_event.outcome', '=', 'started')
    .where(sql`item_event.meta->>'admitted'`, '=', 'true')
    .where('item_event.created_at', '>=', utcDayStart(now))
    .where('item.status', 'not in', ['failed', 'insufficient_source'])
    // Released or requeued items (found, not queued) are candidates again, not spent slots.
    .where((eb) =>
      eb.not(eb.and([eb('item.status', '=', 'found'), eb('item.queued_at', 'is', null)])),
    )
    .groupBy('source')
    .execute()
  return new Map(rows.map((r) => [r.source, Number(r.n)]))
}

async function primarySources(
  db: Database,
  ids: readonly string[],
  now: Date,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const batch of chunked(ids, 100)) {
    const rows = await db
      .selectFrom('mention')
      .select(['item_id', 'source', 'score', 'num_comments', 'published_at'])
      .where('item_id', 'in', batch)
      .execute()
    const byItem = new Map<string, ScoreSignal[]>()
    for (const r of rows) {
      const list = byItem.get(r.item_id) ?? []
      list.push({
        source: r.source,
        score: r.score,
        numComments: r.num_comments,
        publishedAt: new Date(r.published_at),
      })
      byItem.set(r.item_id, list)
    }
    for (const [id, signals] of byItem) {
      const source = primarySource(signals, now)
      if (source) out.set(id, source)
    }
  }
  return out
}

async function admitFound(db: Database, queue: ReconcileQueues['ingest'], now: Date, log: Logger) {
  const minScore = await getSetting(db, SETTINGS.minItemScore, log)
  const dailyCap = await getSetting(db, SETTINGS.dailyReelCap, log)
  const spendCapUsd = await getSetting(db, SETTINGS.pipelineDailySpendCapUsd, log)
  const spent = await spendTodayUsd(db, SPEND_CATEGORIES_FOR_CAP)
  let admittedToday = await countAdmittedToday(db, now)

  const skipped = { below_score: 0, daily_cap: 0, spend_cap: 0 }
  const candidates = await db
    .selectFrom('item')
    .select(['id', 'score'])
    .where('status', '=', 'found')
    .where('queued_at', 'is', null)
    // An item with no mention cannot be summarized (left behind by an interrupted persist).
    .where((eb) =>
      eb.exists(
        eb.selectFrom('mention').select('mention.id').whereRef('mention.item_id', '=', 'item.id'),
      ),
    )
    .orderBy('score', 'desc')
    .limit(ADMISSION_CANDIDATES)
    .execute()

  const sources = await primarySources(
    db,
    candidates.map((c) => c.id),
    now,
  )
  const ordered = interleaveBySource(
    candidates.map((c) => ({ ...c, source: sources.get(c.id) ?? 'unknown' })),
    await admittedTodayBySource(db, now).catch((err) => {
      log.warn(errorFields(err), 'per-source admission counts failed, interleaving from zero')
      return new Map<string, number>()
    }),
    minScore,
  )

  const admit: { id: string; score: number; source: string }[] = []
  for (const item of ordered) {
    const decision = admissionDecision({
      score: item.score,
      minScore,
      admittedToday,
      dailyCap,
      spendTodayUsd: spent,
      spendCapUsd,
    })
    if (decision.admit) {
      admit.push(item)
      admittedToday++
    } else {
      skipped[decision.reason]++
    }
  }
  log.info(
    {
      candidates: candidates.length,
      admit: admit.length,
      admitBySource: Object.fromEntries(
        [...new Set(admit.map((a) => a.source))].map((src) => [
          src,
          admit.filter((a) => a.source === src).length,
        ]),
      ),
      admittedToday,
      dailyCap,
      spent,
      ...skipped,
    },
    'admission decided',
  )

  const claimed = await claim(
    db,
    'found',
    admit.map((a) => a.id),
  )
  const scores = new Map(admit.map((a) => [a.id, a.score]))
  const bySource = new Map(admit.map((a) => [a.id, a.source]))
  for (const c of claimed) {
    await recordItemEvent(
      db,
      {
        itemId: c.id,
        stage: 'found',
        outcome: 'started',
        attempt: c.attempts + 1,
        meta: {
          admitted: true,
          score: scores.get(c.id) ?? null,
          source: bySource.get(c.id) ?? null,
        },
      },
      log,
    )
  }
  const sent = await sendClaimed(db, queue, claimed, log)
  return { admitted: sent, skipped, spendCapReached: spent >= spendCapUsd }
}

export async function reconcile(
  db: Database,
  queues: ReconcileQueues,
  log: Logger,
  now = new Date(),
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const l = log.child({ mod: 'reconcile' })
  const result: ReconcileResult = {
    paused: false,
    stuckRequeued: 0,
    stuckFailed: 0,
    admitted: 0,
    skipped: { below_score: 0, daily_cap: 0, spend_cap: 0 },
    enqueuedSummarized: 0,
    enqueuedEmbedded: 0,
    enqueuedVoiced: 0,
    spendCapReached: false,
  }

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      l.error({ step: name, ...errorFields(err) }, 'reconcile step failed')
    }
  }

  await step('pause', async () => {
    await probePause(db, options.probe, options.alertWebhookUrl, l, now)
    result.paused = (await getPipelinePause(db, l)) !== null
    if (result.paused) l.warn('pipeline paused: skipping stuck handling, summarized and found')
  })

  await step('stuck', async () => {
    if (result.paused) return
    const stuck = await reconcileStuck(db, now, l)
    result.stuckRequeued = stuck.requeued
    result.stuckFailed = stuck.failed
  })
  let budget = 0
  await step('render budget', async () => {
    budget = await renderBudget(db, l)
  })
  await step('embedded', async () => {
    result.enqueuedEmbedded = await enqueueStage(db, queues.render, 'embedded', l, budget)
    budget -= result.enqueuedEmbedded
  })
  await step('voiced', async () => {
    result.enqueuedVoiced = await enqueueStage(db, queues.render, 'voiced', l, budget)
  })
  await step('summarized', async () => {
    if (result.paused) return
    result.enqueuedSummarized = await enqueueStage(db, queues.ingest, 'summarized', l)
  })
  await step('found', async () => {
    if (result.paused) return
    const found = await admitFound(db, queues.ingest, now, l)
    result.admitted = found.admitted
    result.skipped = found.skipped
    result.spendCapReached = found.spendCapReached
  })

  l.info({ ...result }, 'reconcile complete')
  return result
}
