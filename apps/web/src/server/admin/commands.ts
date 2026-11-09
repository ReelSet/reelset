import {
  IngestTaskStatus,
  InvalidTransitionError,
  ItemStatus,
  RenderStatus,
  StageOutcome,
  StaleTransitionError,
  errorFields,
  recordItemEvent,
  setSetting,
  transitionItem,
  type Database,
  type Logger,
} from '@reelset/core'
import { DISCARD_META_KEY, RENDER_RETRY_STAGE, type RetryStage } from '@/lib/admin/retry'
import { parseSettingInput, settingFields } from '@/lib/admin/settings-form'

export type CommandResult = { ok: true; message: string } | { ok: false; message: string }

export async function retryItem(
  db: Database,
  input: { itemId: string; stage: RetryStage; adminId: string; resetRenderId?: string },
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'retryItem', itemId: input.itemId, stage: input.stage })
  try {
    await db.transaction().execute(async (trx) => {
      await transitionItem(
        trx,
        {
          itemId: input.itemId,
          from: ItemStatus.failed,
          to: input.stage,
          meta: { adminRetry: true, adminId: input.adminId },
        },
        l,
      )
      await trx
        .updateTable('item')
        .set({ queued_at: null, attempts: 0 })
        .where('id', '=', input.itemId)
        .execute()
      if (input.resetRenderId) {
        await trx
          .updateTable('render')
          .set({ attempts: 0 })
          .where('id', '=', input.resetRenderId)
          .execute()
      }
    })
    l.info({ resetRenderId: input.resetRenderId }, 'item retried by admin')
    return {
      ok: true,
      message: `Item moved back to ${input.stage}; the ingest reconciler re-queues it on its next run`,
    }
  } catch (err) {
    if (err instanceof StaleTransitionError) {
      l.warn('retry lost: item is no longer failed')
      return { ok: false, message: 'Item is no longer in failed status' }
    }
    if (err instanceof InvalidTransitionError) {
      return { ok: false, message: err.message }
    }
    l.error(errorFields(err), 'item retry failed')
    throw err
  }
}

export async function discardItem(
  db: Database,
  input: { itemId: string; adminId: string },
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'discardItem', itemId: input.itemId })
  const discarded = await db.transaction().execute(async (trx) => {
    const item = await trx
      .selectFrom('item')
      .select('status')
      .where('id', '=', input.itemId)
      .forUpdate()
      .executeTakeFirst()
    if (!item) return 'missing' as const
    if (item.status !== ItemStatus.failed) return 'not_failed' as const
    await recordItemEvent(
      trx,
      {
        itemId: input.itemId,
        stage: ItemStatus.failed,
        outcome: StageOutcome.skipped,
        meta: { [DISCARD_META_KEY]: true, adminId: input.adminId },
      },
      l,
    )
    return 'discarded' as const
  })
  if (discarded === 'missing') return { ok: false, message: 'Item not found' }
  if (discarded === 'not_failed') {
    l.warn('discard refused: item is not failed')
    return { ok: false, message: 'Item is no longer in failed status' }
  }
  l.info('item discarded by admin')
  return { ok: true, message: 'Item discarded; it stays failed and is hidden from the failed list' }
}

export async function retryRender(
  db: Database,
  input: { renderId: string; adminId: string },
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'retryRender', renderId: input.renderId })
  const render = await db
    .selectFrom('render')
    .select(['item_id', 'status'])
    .where('id', '=', input.renderId)
    .executeTakeFirst()
  if (!render) return { ok: false, message: 'Render not found' }
  if (render.status !== RenderStatus.failed) {
    return { ok: false, message: `Render is ${render.status}, only failed renders can be retried` }
  }
  const result = await retryItem(
    db,
    {
      itemId: render.item_id,
      stage: RENDER_RETRY_STAGE,
      adminId: input.adminId,
      resetRenderId: input.renderId,
    },
    l,
  )
  if (!result.ok) return { ok: false, message: `Item not retried: ${result.message}` }
  return { ok: true, message: `Item moved back to ${RENDER_RETRY_STAGE}; render will be re-queued` }
}

export async function retryIngestTask(
  db: Database,
  input: { taskId: string },
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'retryIngestTask', taskId: input.taskId })
  const res = await db
    .updateTable('ingest_task')
    .set({ status: IngestTaskStatus.deferred })
    .where('id', '=', input.taskId)
    .where('status', '=', IngestTaskStatus.failed)
    .executeTakeFirst()
  if (Number(res.numUpdatedRows) === 0) {
    l.warn('task not failed or missing')
    return { ok: false, message: 'Task is not in failed status' }
  }
  l.info('ingest task deferred by admin')
  return {
    ok: true,
    message: 'Task marked deferred. Ingest runs on Cloudflare and picks it up on the next cron run',
  }
}

export async function saveSetting(
  db: Database,
  input: { name: string; raw: unknown },
  log: Logger,
): Promise<CommandResult> {
  const field = settingFields().find((f) => f.name === input.name)
  if (!field) return { ok: false, message: 'Unknown setting' }
  const l = log.child({ fn: 'saveSetting', key: field.def.key })

  const parsed = parseSettingInput(field, input.raw)
  if (!parsed.ok) {
    l.info({ error: parsed.error }, 'setting rejected')
    return { ok: false, message: `${field.def.key}: ${parsed.error}` }
  }
  await setSetting(db, field.def, parsed.value, l)
  return { ok: true, message: `${field.def.key} saved` }
}
