import { sql } from 'kysely'
import {
  CAP_EXEMPT_STATUSES,
  SETTINGS,
  dayShare,
  sameStory,
  pacedCap,
  StaleTransitionError,
  errorFields,
  getPipelinePause,
  getSetting,
  recordItemEvent,
  spendTodayUsd,
  type Database,
  type ItemStatus,
  type Logger,
} from '@reelset/core'
import {
  ADMISSION_CANDIDATES,
  ADMISSION_OVERRIDES,
  DUPLICATE_WINDOW_MS,
  ENQUEUE_CHUNK,
  PACE_BYPASS_GATE_SCORE,
  RECONCILE_BATCH,
  REEL_COST_WINDOW_MS,
  SPEND_CATEGORIES_FOR_CAP,
  RENDER_QUEUED_LIVE_MS,
  RENDER_RENDERING_LIVE_MS,
  STUCK_AFTER_MS,
} from '../config'
import { transitionClearingPriority } from '../generate/priority'
import type { IngestItemMessage, RenderJobMessage } from '../env'
import {
  admissionDecision,
  chunked,
  classifyStuck,
  interleaveBySource,
  reelCostEstimate,
  utcDayStart,
  type AdmissionSkip,
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
  skipped: Record<AdmissionSkip, number>
  enqueuedSummarized: number
  enqueuedEmbedded: number
  enqueuedVoiced: number
  spendCapReached: boolean
}

type Claimed = { id: string; attempts: number; priority: boolean }

async function claim(db: Database, status: ItemStatus, ids: readonly string[]): Promise<Claimed[]> {
  if (ids.length === 0) return []
  const rows = await db
    .updateTable('item')
    .set({ queued_at: sql`now()` })
    .where('id', 'in', ids)
    .where('status', '=', status)
    .where('queued_at', 'is', null)
    .returning(['id', 'attempts', sql<boolean>`priority_at is not null`.as('priority')])
    .execute()
  return rows
}

async function release(db: Database, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await db.updateTable('item').set({ queued_at: null }).where('id', 'in', ids).execute()
}

async function sendClaimed(
  db: Database,
  queue: BatchSender<{ itemId: string; attempt: number; priority?: boolean }>,
  claimed: readonly Claimed[],
  log: Logger,
  flagPriority = false,
): Promise<number> {
  let sent = 0
  for (const batch of chunked(claimed, ENQUEUE_CHUNK)) {
    try {
      await queue.sendBatch(
        batch.map((c) => ({
          body: {
            itemId: c.id,
            attempt: c.attempts,
            ...(flagPriority && c.priority ? { priority: true } : {}),
          },
        })),
      )
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
    // A fresh queued or rendering render means the item is waiting its turn on a render box, not
    // stuck. Past the live windows the queue message is presumed gone and the item is requeued.
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('render')
            .select('render.id')
            .whereRef('render.item_id', '=', 'item.id')
            .where((rb) =>
              rb.or([
                rb.and([
                  rb('render.status', '=', 'queued'),
                  rb('item.queued_at', '>', new Date(now.getTime() - RENDER_QUEUED_LIVE_MS)),
                ]),
                rb.and([
                  rb('render.status', '=', 'rendering'),
                  rb('render.started_at', '>', new Date(now.getTime() - RENDER_RENDERING_LIVE_MS)),
                ]),
              ]),
            ),
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
        await transitionClearingPriority(
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
  queue: BatchSender<{ itemId: string; attempt: number; priority?: boolean }>,
  status: 'summarized' | 'embedded' | 'voiced',
  log: Logger,
  limit = RECONCILE_BATCH,
  priorityIgnoresLimit = false,
): Promise<number> {
  if (limit <= 0 && !priorityIgnoresLimit) return 0
  const rows = await db
    .selectFrom('item')
    .select(['id', sql<boolean>`priority_at is not null`.as('priority')])
    .where('status', '=', status)
    .where('queued_at', 'is', null)
    .orderBy(sql`priority_at is not null`, 'desc')
    .orderBy('score', 'desc')
    .limit(RECONCILE_BATCH)
    .execute()
  let room = Math.min(limit, RECONCILE_BATCH)
  const picked = rows.filter((r) => (priorityIgnoresLimit && r.priority) || room-- > 0)
  const claimed = await claim(
    db,
    status,
    picked.map((r) => r.id),
  )
  const sent = await sendClaimed(db, queue, claimed, log, priorityIgnoresLimit)
  if (sent > 0) log.info({ status, sent }, 'items enqueued')
  return sent
}

async function renderBudget(db: Database, now: Date, log: Logger): Promise<number> {
  const maxInFlight = await getSetting(db, SETTINGS.renderMaxInFlight, log)
  const row = await db
    .selectFrom('item')
    .select(sql<string>`count(*)`.as('n'))
    .where('status', 'in', ['embedded', 'voiced'])
    .where('queued_at', '>', new Date(now.getTime() - RENDER_QUEUED_LIVE_MS))
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
    // Failed, thin-source and gate-rejected items never become a reel, so they must not eat the cap.
    .where('item.status', 'not in', CAP_EXEMPT_STATUSES)
    // Released or requeued items (found, not queued) are candidates again, not spent slots.
    .where((eb) =>
      eb.not(eb.and([eb('item.status', '=', 'found'), eb('item.queued_at', 'is', null)])),
    )
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

async function countUnscripted(db: Database): Promise<number> {
  const row = await db
    .selectFrom('item')
    .select((eb) => eb.fn.countAll<string>().as('unscripted'))
    .where('status', '=', 'found')
    .where('queued_at', 'is not', null)
    .executeTakeFirst()
  return Number(row?.unscripted ?? 0)
}

async function recentReelCostUsd(db: Database, now: Date): Promise<number> {
  const since = new Date(now.getTime() - REEL_COST_WINDOW_MS)
  const [spend, reels] = await Promise.all([
    db
      .selectFrom('spend_ledger')
      .select(sql<string>`coalesce(sum(cost_usd), 0)`.as('window_usd'))
      .where('created_at', '>=', since)
      .where('category', 'in', SPEND_CATEGORIES_FOR_CAP)
      .executeTakeFirst(),
    db
      .selectFrom('item_event')
      .select((eb) => eb.fn.countAll<string>().as('reels'))
      .where('stage', '=', 'rendered')
      .where('outcome', '=', 'ok')
      .where('created_at', '>=', since)
      .executeTakeFirst(),
  ])
  return reelCostEstimate(Number(spend?.window_usd ?? 0), Number(reels?.reels ?? 0))
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
    .where('item.status', 'not in', CAP_EXEMPT_STATUSES)
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

type FoundCandidate = { id: string; score: number }

/** Found items an admin sent back with "make a reel anyway" (their latest gate decision, manual judgements aside). A failed lookup yields none, so admission carries on as usual. */
async function overriddenFound(db: Database, log: Logger): Promise<FoundCandidate[]> {
  try {
    const { rows } = await sql<FoundCandidate>`
      select item.id, item.score
      from item
      where item.status = 'found'
        and item.queued_at is null
        and exists (select 1 from mention m where m.item_id = item.id)
        and (
          select d.decided_by = 'admin' and d.verdict = 'reel'
          from gate_decision d
          where d.item_id = item.id and d.trigger = 'auto'
          order by d.created_at desc, d.id desc
          limit 1
        )
      order by item.score desc
      limit ${ADMISSION_OVERRIDES}`.execute(db)
    return rows.map((row) => ({ id: row.id, score: Number(row.score) }))
  } catch (err) {
    log.warn(errorFields(err), 'gate override lookup failed, admitting by score only')
    return []
  }
}

/** Found items someone asked for (a reel request or an admin retry of one). New requests are sent straight to the queue, but a retried or requeued one lands back here and would otherwise rank by score among thousands of feed items and never be picked. */
async function requestedFound(db: Database): Promise<FoundCandidate[]> {
  const rows = await db
    .selectFrom('item')
    .select(['id', 'score', 'priority_at'])
    .where('status', '=', 'found')
    .where('queued_at', 'is', null)
    .where('priority_at', 'is not', null)
    .where((eb) =>
      eb.exists(
        eb.selectFrom('mention').select('mention.id').whereRef('mention.item_id', '=', 'item.id'),
      ),
    )
    .orderBy('priority_at', 'asc')
    .limit(ADMISSION_OVERRIDES)
    .execute()
  return rows.map((row) => ({ id: row.id, score: Number(row.score) }))
}

/** Titles of items admitted within the duplicate window, so a retelling of one is not made again. */
async function recentAdmittedTitles(
  db: Database,
  now: Date,
): Promise<{ id: string; title: string }[]> {
  return db
    .selectFrom('item')
    .select(['id', 'title'])
    .where('queued_at', '>=', new Date(now.getTime() - DUPLICATE_WINDOW_MS))
    .where('status', 'not in', CAP_EXEMPT_STATUSES)
    .execute()
}

async function titlesOf(db: Database, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const batch of chunked(ids, 100)) {
    const rows = await db
      .selectFrom('item')
      .select(['id', 'title'])
      .where('id', 'in', batch)
      .execute()
    for (const r of rows) out.set(r.id, r.title)
  }
  return out
}

/** Each item's latest automatic gate score, read like the override lookup reads its decision. */
async function latestGateScores(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const batch of chunked(ids, 100)) {
    const { rows } = await sql<{ item_id: string; score: number | null }>`
      select distinct on (d.item_id) d.item_id, d.score
      from gate_decision d
      where d.item_id in (${sql.join(batch)}) and d.trigger = 'auto'
      order by d.item_id, d.created_at desc, d.id desc`.execute(db)
    for (const r of rows) if (r.score !== null) out.set(r.item_id, Number(r.score))
  }
  return out
}

async function admitFound(db: Database, queue: ReconcileQueues['ingest'], now: Date, log: Logger) {
  const minScore = await getSetting(db, SETTINGS.minItemScore, log)
  const dailyCap = await getSetting(db, SETTINGS.dailyReelCap, log)
  const spendCapUsd = await getSetting(db, SETTINGS.pipelineDailySpendCapUsd, log)
  const spent = await spendTodayUsd(db, SPEND_CATEGORIES_FOR_CAP)
  let admittedToday = await countAdmittedToday(db, now)
  const reelCostUsd = await recentReelCostUsd(db, now).catch((err) => {
    log.warn(errorFields(err), 'reel cost lookup failed, reserving the default')
    return reelCostEstimate(0, 0)
  })
  const unscripted = await countUnscripted(db)
  // Spend lands minutes to hours after admission, so admitted items not yet scripted are reserved.
  let committedUsd = spent + unscripted * reelCostUsd
  const share = dayShare(now)
  const openSlots = pacedCap(dailyCap, now)

  const skipped: Record<AdmissionSkip, number> = {
    below_score: 0,
    daily_cap: 0,
    spend_cap: 0,
    pace: 0,
    duplicate: 0,
  }
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

  // Requested reels are paid for, so like a fresh request they skip the score floor and both caps.
  const requested = await requestedFound(db).catch((err) => {
    log.warn(errorFields(err), 'requested reel lookup failed, admitting by score only')
    return [] as FoundCandidate[]
  })
  const requestedIds = new Set(requested.map((r) => r.id))
  const overrides = (await overriddenFound(db, log)).filter((o) => !requestedIds.has(o.id))
  const overridden = new Set(overrides.map((o) => o.id))
  const ordinary = candidates.filter((c) => !overridden.has(c.id) && !requestedIds.has(c.id))
  const sources = await primarySources(
    db,
    [...overrides, ...ordinary].map((c) => c.id),
    now,
  )
  const withSource = (c: FoundCandidate) => ({ ...c, source: sources.get(c.id) ?? 'unknown' })
  const interleaved = interleaveBySource(
    ordinary.map(withSource),
    await admittedTodayBySource(db, now).catch((err) => {
      log.warn(errorFields(err), 'per-source admission counts failed, interleaving from zero')
      return new Map<string, number>()
    }),
    minScore,
  )
  const ordered = [...overrides.map(withSource), ...interleaved]

  // Items under the score floor are skipped on score alone, so only the rest need a title or gate score.
  const eligible = ordered
    .filter((c) => overridden.has(c.id) || c.score >= minScore)
    .map((c) => c.id)
  const recentTitles = await recentAdmittedTitles(db, now).catch((err) => {
    log.warn(errorFields(err), 'recent titles lookup failed, not checking for duplicate stories')
    return null
  })
  const titles = recentTitles
    ? await titlesOf(db, eligible).catch((err) => {
        log.warn(errorFields(err), 'title lookup failed, not checking for duplicate stories')
        return new Map<string, string>()
      })
    : new Map<string, string>()
  const gateScores = await latestGateScores(db, eligible).catch((err) => {
    log.warn(errorFields(err), 'gate score lookup failed, no fast lane this run')
    return new Map<string, number>()
  })
  const seen = [...(recentTitles ?? [])]

  const admit: { id: string; score: number; source: string }[] = []
  for (const item of ordered) {
    const override = overridden.has(item.id)
    const title = titles.get(item.id)
    // An admin who sent an item back with "make a reel anyway" has seen the story; no twin check.
    if (title !== undefined && !override && item.score >= minScore) {
      const twin = seen.find((t) => sameStory(title, t.title))
      if (twin) {
        skipped.duplicate++
        log.debug(
          { itemId: item.id, title, twinItemId: twin.id, twinTitle: twin.title },
          'duplicate story skipped',
        )
        continue
      }
    }
    // An admin override outranks the score floor (scores decay) and pacing, not the daily caps.
    const decision = admissionDecision({
      score: item.score,
      minScore: override ? Number.NEGATIVE_INFINITY : minScore,
      admittedToday,
      dailyCap,
      pacedCap: override ? dailyCap : openSlots,
      committedUsd,
      spendCapUsd,
      pacedSpendCapUsd: override ? spendCapUsd : spendCapUsd * share,
      fastTrack: (gateScores.get(item.id) ?? Number.NEGATIVE_INFINITY) >= PACE_BYPASS_GATE_SCORE,
    })
    if (decision.admit) {
      admit.push(item)
      if (title !== undefined) seen.push({ id: item.id, title })
      admittedToday++
      committedUsd += reelCostUsd
    } else {
      skipped[decision.reason]++
    }
  }
  log.info(
    {
      candidates: candidates.length,
      requested: requested.length,
      overrides: overrides.length,
      admit: admit.length,
      admitBySource: Object.fromEntries(
        [...new Set(admit.map((a) => a.source))].map((src) => [
          src,
          admit.filter((a) => a.source === src).length,
        ]),
      ),
      admittedToday,
      dailyCap,
      openSlots,
      spent,
      unscripted,
      reelCostUsd,
      committedUsd,
      pacedSpendCapUsd: spendCapUsd * share,
      ...skipped,
    },
    'admission decided',
  )

  const claimed = await claim(db, 'found', [
    ...requested.map((r) => r.id),
    ...admit.map((a) => a.id),
  ])
  const scores = new Map(admit.map((a) => [a.id, a.score]))
  const bySource = new Map(admit.map((a) => [a.id, a.source]))
  for (const c of claimed) {
    // A requested item is not marked admitted, so it never takes a feed item's daily slot.
    const meta = requestedIds.has(c.id)
      ? { requested: true }
      : {
          admitted: true,
          score: scores.get(c.id) ?? null,
          source: bySource.get(c.id) ?? null,
          ...(overridden.has(c.id) ? { gateOverride: true } : {}),
        }
    await recordItemEvent(
      db,
      { itemId: c.id, stage: 'found', outcome: 'started', attempt: c.attempts + 1, meta },
      log,
    )
    if (requestedIds.has(c.id)) log.info({ itemId: c.id }, 'requested reel admitted past the caps')
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
    skipped: { below_score: 0, daily_cap: 0, spend_cap: 0, pace: 0, duplicate: 0 },
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
    budget = await renderBudget(db, now, l)
  })
  await step('embedded', async () => {
    result.enqueuedEmbedded = await enqueueStage(db, queues.render, 'embedded', l, budget, true)
    budget -= result.enqueuedEmbedded
  })
  await step('voiced', async () => {
    result.enqueuedVoiced = await enqueueStage(db, queues.render, 'voiced', l, budget, true)
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
