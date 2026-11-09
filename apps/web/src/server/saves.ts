import { ItemStatus, errorFields, type Database, type Logger } from '@reelset/core'

export type SetSaveResult =
  { status: 'ok'; saved: boolean; changed: boolean } | { status: 'not_found' }

export async function setSave(
  db: Database,
  input: { profileId: string; itemId: string; saved: boolean },
  log: Logger,
): Promise<SetSaveResult> {
  const l = log.child({ fn: 'setSave', profileId: input.profileId, itemId: input.itemId })
  try {
    const item = await db
      .selectFrom('item')
      .select('id')
      .where('id', '=', input.itemId)
      .where('status', '=', ItemStatus.rendered)
      .executeTakeFirst()
    if (!item) {
      l.info('save target not found or not visible')
      return { status: 'not_found' }
    }
    let affected: bigint
    if (input.saved) {
      const res = await db
        .insertInto('save')
        .values({ profile_id: input.profileId, item_id: input.itemId })
        .onConflict((oc) => oc.columns(['profile_id', 'item_id']).doNothing())
        .executeTakeFirst()
      affected = res.numInsertedOrUpdatedRows ?? 0n
    } else {
      const res = await db
        .deleteFrom('save')
        .where('profile_id', '=', input.profileId)
        .where('item_id', '=', input.itemId)
        .executeTakeFirst()
      affected = res.numDeletedRows
    }
    l.info({ saved: input.saved, changed: affected > 0n }, 'save applied')
    return { status: 'ok', saved: input.saved, changed: affected > 0n }
  } catch (err) {
    l.error(errorFields(err), 'save failed')
    throw err
  }
}
