import { sql } from 'kysely'
import {
  HIDDEN_REQUEST_MESSAGE,
  INSUFFICIENT_SOURCE_MESSAGE,
  RENDER_FAILED_MESSAGE,
  claimPendingReelRequests,
  errorFields,
  getPipelinePause,
  recordItemEvent,
  refundRequest,
  setReelRequestResult,
  transitionItem,
  type Database,
  type Logger,
  type ReelRequestRow,
} from '@reelset/core'
import { resolveItemTarget, type ItemTarget } from '../canonical'
import type { IngestItemMessage } from '../env'
import { rescoreItems, upsertMentions } from '../ingest/persist'
import type { NormalizedMention, ScrapeFallback } from '../types'
import { classifyUrl, resolveSource, MESSAGES } from './resolve'

export const GENERATE_BATCH = 10
export const RESOLVING_STALE_MS = 10 * 60_000
export const REQUEST_GIVE_UP_MS = 15 * 60_000
export const GENERIC_FAILURE_MESSAGE =
  'Something went wrong while reading those links. Your credits were refunded.'

export type GenerateDeps = {
  db: Database
  log: Logger
  queue: { send: (message: IngestItemMessage) => Promise<unknown> }
  githubToken?: string
  scrape?: ScrapeFallback
  now?: () => Date
}

export type GenerateResult = {
  claimed: number
  done: number
  processing: number
  failed: number
  retried: number
  gated: 'paused' | null
}

type ItemState = {
  id: string
  status: string
  queued_at: Date | null
  hasDoneRender: boolean
}

type ExistingItem = ItemState & { visibility: string }

const DONE_RENDER = sql<boolean>`exists (
  select 1 from render
  where render.item_id = item.id and render.status = 'done' and render.video_key is not null
)`

async function failRequest(
  db: Database,
  req: ReelRequestRow,
  message: string,
  itemId: string | null,
  log: Logger,
): Promise<boolean> {
  const changed = await setReelRequestResult(
    db,
    req.id,
    { status: 'failed', error: message, ...(itemId ? { itemId } : {}) },
    ['resolving'],
  )
  if (changed) await refundRequest(db, req.id, log)
  log.info({ error: message }, 'reel request failed')
  return changed
}

async function doneInstantly(
  db: Database,
  req: ReelRequestRow,
  itemId: string,
  log: Logger,
): Promise<void> {
  await setReelRequestResult(db, req.id, { status: 'done', itemId }, ['resolving'])
  await refundRequest(db, req.id, log)
  log.info({ itemId }, 'item already rendered, request done instantly and refunded')
}

async function failHidden(
  db: Database,
  req: ReelRequestRow,
  itemId: string,
  log: Logger,
): Promise<'failed'> {
  log.info({ itemId }, 'requested item is hidden from the feed, request refused')
  await failRequest(db, req, HIDDEN_REQUEST_MESSAGE, null, log)
  return 'failed'
}

async function existingByKey(db: Database, key: string): Promise<ExistingItem | null> {
  const row = await db
    .selectFrom('item')
    .select(['id', 'status', 'queued_at', 'visibility', DONE_RENDER.as('has_done_render')])
    .where('canonical_key', '=', key)
    .executeTakeFirst()
  return row
    ? {
        id: row.id,
        status: row.status,
        queued_at: row.queued_at,
        hasDoneRender: row.has_done_render,
        visibility: row.visibility,
      }
    : null
}

async function upsertItem(
  db: Database,
  target: ItemTarget,
  primary: NormalizedMention,
  mentions: readonly NormalizedMention[],
  req: ReelRequestRow,
): Promise<{ state: ItemState; created: boolean }> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('item')
      .values({
        canonical_key: target.canonicalKey,
        canonical_url: target.canonicalUrl,
        kind: target.kind,
        title: primary.title,
        published_at: primary.publishedAt,
        visibility: 'private',
        owner_id: req.user_id,
        priority_at: sql`now()`,
      })
      // A request for an item already waiting in the backlog must still jump the queue.
      .onConflict((oc) =>
        oc.column('canonical_key').doUpdateSet({
          updated_at: sql`now()`,
          priority_at: sql`case when item.status in ('rendered', 'failed', 'insufficient_source')
            then item.priority_at else coalesce(item.priority_at, now()) end`,
        }),
      )
      .returning(['id', 'status', 'queued_at', sql<boolean>`(xmax = 0)`.as('created')])
      .executeTakeFirstOrThrow()
    await upsertMentions(
      trx,
      mentions.map((mention) => ({ itemId: row.id, mention })),
      { inserted: 0, updated: 0 },
    )
    const done = await trx
      .selectFrom('item')
      .select(DONE_RENDER.as('has_done_render'))
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow()
    return {
      created: row.created,
      state: {
        id: row.id,
        status: row.status,
        queued_at: row.queued_at,
        hasDoneRender: done.has_done_render,
      },
    }
  })
}

type Remake = {
  itemId: string
  from: 'rendered' | 'source_only'
  reason: 'video_missing' | 'requested'
}

/** Sends a settled item back to `found` at priority for a request: a rendered item whose video is gone, or one the gate kept as source only (a request outranks the gate). */
async function remake(
  deps: GenerateDeps,
  req: ReelRequestRow,
  { itemId, from, reason }: Remake,
  log: Logger,
): Promise<'processing'> {
  const { db } = deps
  await transitionItem(
    db,
    { itemId, from, to: 'found', meta: { manual: true, requestId: req.id, reason } },
    log,
  )
  await db
    .updateTable('item')
    .set({ queued_at: null, attempts: 0, priority_at: sql`now()` })
    .where('id', '=', itemId)
    .execute()
  await kickItem(deps, itemId, req.id, log)
  await setReelRequestResult(db, req.id, { status: 'processing', itemId }, ['resolving'])
  log.info({ from, reason }, 'settled item sent back through the pipeline for the request')
  return 'processing'
}

async function kickItem(
  deps: GenerateDeps,
  itemId: string,
  requestId: string,
  log: Logger,
): Promise<boolean> {
  const { db } = deps
  const claimed = await db
    .updateTable('item')
    .set({ queued_at: sql`now()` })
    .where('id', '=', itemId)
    .where('status', '=', 'found')
    .where('queued_at', 'is', null)
    .returning(['attempts'])
    .executeTakeFirst()
  if (!claimed) return false
  await recordItemEvent(
    db,
    {
      itemId,
      stage: 'found',
      outcome: 'started',
      attempt: claimed.attempts + 1,
      meta: { manual: true, requestId },
    },
    log,
  )
  try {
    await deps.queue.send({ itemId, attempt: 1 })
  } catch (err) {
    await db.updateTable('item').set({ queued_at: null }).where('id', '=', itemId).execute()
    throw err
  }
  log.info('manual item enqueued for ingest')
  return true
}

type Outcome = 'done' | 'processing' | 'failed'

async function handleRequest(
  deps: GenerateDeps,
  req: ReelRequestRow,
  log: Logger,
): Promise<Outcome> {
  const { db } = deps
  const urls = [...new Set(req.urls.map((u) => u.trim()).filter(Boolean))]
  if (urls.length === 0) {
    await failRequest(db, req, MESSAGES.invalid, null, log)
    return 'failed'
  }

  const first = classifyUrl(urls[0]!)
  if (first.ok && first.ref.kind !== 'hn' && first.ref.kind !== 'reddit') {
    const key = resolveItemTarget({
      source: 'news',
      externalId: urls[0]!,
      url: urls[0]!,
      linkedUrl: urls[0]!,
    })?.canonicalKey
    const existing = key ? await existingByKey(db, key) : null
    if (existing?.visibility === 'hidden') return failHidden(db, req, existing.id, log)
    if (existing?.status === 'rendered' && existing.hasDoneRender) {
      await doneInstantly(db, req, existing.id, log)
      return 'done'
    }
  }

  const mentions: NormalizedMention[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const url of urls) {
    const res = await resolveSource(url, {
      log,
      githubToken: deps.githubToken,
      scrape: deps.scrape,
      now: deps.now,
    })
    if (!res.ok) {
      errors.push(res.message)
      log.warn({ url: url.slice(0, 200), message: res.message }, 'source could not be resolved')
      continue
    }
    const id = `${res.mention.source}\u0000${res.mention.externalId}`
    if (seen.has(id)) continue
    seen.add(id)
    mentions.push(res.mention)
  }
  const primary = mentions[0]
  const target = primary ? resolveItemTarget(primary) : null
  if (!primary || !target) {
    const message =
      errors.length > 1
        ? `None of those links could be read. ${errors[0]}`
        : (errors[0] ?? MESSAGES.unsupported)
    await failRequest(db, req, message, null, log)
    return 'failed'
  }

  const known = await existingByKey(db, target.canonicalKey)
  if (known?.visibility === 'hidden') return failHidden(db, req, known.id, log)

  const { state, created } = await upsertItem(db, target, primary, mentions, req)
  const il = log.child({ itemId: state.id, created, status: state.status })
  await rescoreItems(db, [state.id], (deps.now ?? (() => new Date()))(), il)

  if (state.status === 'rendered') {
    if (state.hasDoneRender) {
      await doneInstantly(db, req, state.id, il)
      return 'done'
    }
    return remake(deps, req, { itemId: state.id, from: 'rendered', reason: 'video_missing' }, il)
  }
  if (state.status === 'insufficient_source') {
    await failRequest(db, req, INSUFFICIENT_SOURCE_MESSAGE, state.id, il)
    return 'failed'
  }
  if (state.status === 'source_only') {
    return remake(deps, req, { itemId: state.id, from: 'source_only', reason: 'requested' }, il)
  }
  if (state.status === 'failed') {
    await failRequest(db, req, RENDER_FAILED_MESSAGE, state.id, il)
    return 'failed'
  }

  if (state.status === 'found') await kickItem(deps, state.id, req.id, il)
  await setReelRequestResult(db, req.id, { status: 'processing', itemId: state.id }, ['resolving'])
  il.info({ extraSources: mentions.length - 1 }, 'reel request attached to item')
  return 'processing'
}

// Requested reels are paid for with credits, so only a manual pause holds them, never spend caps.
async function gate(db: Database, log: Logger): Promise<GenerateResult['gated']> {
  return (await getPipelinePause(db, log)) ? 'paused' : null
}

export async function processReelRequests(deps: GenerateDeps): Promise<GenerateResult> {
  const { db } = deps
  const log = deps.log.child({ mod: 'generate' })
  const now = (deps.now ?? (() => new Date()))()
  const result: GenerateResult = {
    claimed: 0,
    done: 0,
    processing: 0,
    failed: 0,
    retried: 0,
    gated: null,
  }

  await db
    .updateTable('reel_request')
    .set({ status: 'pending', updated_at: sql`now()` })
    .where('status', '=', 'resolving')
    .where('updated_at', '<', new Date(now.getTime() - RESOLVING_STALE_MS))
    .execute()

  result.gated = await gate(db, log)
  if (result.gated) {
    log.warn({ gate: result.gated }, 'reel requests left pending')
    return result
  }

  const claimed = await claimPendingReelRequests(db, GENERATE_BATCH)
  result.claimed = claimed.length
  for (const req of claimed) {
    const rl = log.child({ requestId: req.id, userId: req.user_id, urls: req.urls.length })
    try {
      const outcome = await handleRequest(deps, req, rl)
      result[outcome]++
    } catch (err) {
      rl.error(errorFields(err), 'reel request handling errored')
      const age = now.getTime() - new Date(req.created_at).getTime()
      try {
        if (age > REQUEST_GIVE_UP_MS) {
          await failRequest(db, req, GENERIC_FAILURE_MESSAGE, null, rl)
          result.failed++
        } else {
          await setReelRequestResult(db, req.id, { status: 'pending' }, ['resolving'])
          result.retried++
        }
      } catch (inner) {
        rl.error(errorFields(inner), 'could not record reel request error')
      }
    }
  }
  if (result.claimed > 0) log.info({ ...result }, 'reel requests processed')
  return result
}
