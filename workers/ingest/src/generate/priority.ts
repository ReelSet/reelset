import { transitionItem, type Database, type Logger, type TransitionInput } from '@reelset/core'

const TERMINAL = new Set(['rendered', 'failed', 'insufficient_source'])

/** transitionItem, then drop the queue-jump flag once the item can no longer be waiting for a render. */
export async function transitionClearingPriority(
  db: Database,
  input: TransitionInput,
  log: Logger,
): Promise<void> {
  await transitionItem(db, input, log)
  if (!TERMINAL.has(input.to)) return
  await db
    .updateTable('item')
    .set({ priority_at: null })
    .where('id', '=', input.itemId)
    .where('priority_at', 'is not', null)
    .execute()
}
