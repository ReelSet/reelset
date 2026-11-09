import { sql } from 'kysely'
import type { Database } from '../db/client'
import type { ItemStatus, StageOutcome } from '../db/enums'
import { toVectorLiteral } from '../domain/embedding'
import { assertTransition } from '../domain/item-status'
import type { Logger } from '../lib/logger'

export type ItemEventInput = {
  itemId: string
  stage: ItemStatus
  outcome: StageOutcome
  attempt?: number
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

export async function recordItemEvent(db: Database, input: ItemEventInput, log: Logger) {
  await db
    .insertInto('item_event')
    .values({
      item_id: input.itemId,
      stage: input.stage,
      outcome: input.outcome,
      attempt: input.attempt ?? 1,
      duration_ms: input.durationMs ?? null,
      error: input.error ?? null,
      meta: input.meta ? JSON.stringify(input.meta) : null,
    })
    .execute()
  log.debug(
    { itemId: input.itemId, stage: input.stage, outcome: input.outcome, attempt: input.attempt },
    'item event recorded',
  )
}

export class StaleTransitionError extends Error {
  constructor(
    readonly itemId: string,
    readonly expected: ItemStatus,
  ) {
    super(`item ${itemId} is no longer in status ${expected}`)
    this.name = 'StaleTransitionError'
  }
}

export type TransitionInput = {
  itemId: string
  from: ItemStatus
  to: ItemStatus
  attempt?: number
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

/**
 * Moves an item to a new status and writes the matching item_event in one transaction
 * (the caller's, if it passes one; Kysely forbids nesting).
 * The `where status = from` guard makes concurrent or duplicate queue deliveries lose cleanly
 * with StaleTransitionError instead of double-advancing the item.
 */
export async function transitionItem(db: Database, input: TransitionInput, log: Logger) {
  assertTransition(input.from, input.to)
  const l = log.child({ itemId: input.itemId, from: input.from, to: input.to })

  const run = async (trx: Database) => {
    const updated = await trx
      .updateTable('item')
      .set({
        status: input.to,
        status_changed_at: sql`now()`,
        updated_at: sql`now()`,
        last_error: input.to === 'failed' ? (input.error ?? null) : null,
        rendered_at: input.to === 'rendered' ? sql`now()` : undefined,
      })
      .where('id', '=', input.itemId)
      .where('status', '=', input.from)
      .executeTakeFirst()

    if (Number(updated.numUpdatedRows) === 0) {
      l.warn('transition lost: item status changed underneath us')
      throw new StaleTransitionError(input.itemId, input.from)
    }

    await recordItemEvent(
      trx,
      {
        itemId: input.itemId,
        stage: input.to,
        outcome: input.to === 'failed' ? 'failed' : 'ok',
        attempt: input.attempt,
        durationMs: input.durationMs,
        error: input.error,
        meta: input.meta,
      },
      l,
    )
  }

  if (db.isTransaction) {
    await run(db)
  } else {
    await db.transaction().execute(run)
  }

  l.info({ joinedTransaction: db.isTransaction }, 'item transitioned')
}

export async function setItemEmbedding(
  db: Database,
  itemId: string,
  values: readonly number[],
  log: Logger,
) {
  const literal = toVectorLiteral(values)
  await sql`update item set embedding = ${literal}::vector, updated_at = now() where id = ${itemId}`.execute(
    db,
  )
  log.debug({ itemId, dims: values.length }, 'item embedding set')
}
