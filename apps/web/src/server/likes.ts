import { ItemStatus, errorFields, type Database, type Logger } from '@reelset/core'
import { likeOutcome } from '@/lib/likes'

export type SetLikeResult =
  { status: 'ok'; liked: boolean; changed: boolean; likeCount: number } | { status: 'not_found' }

export async function setLike(
  db: Database,
  input: { profileId: string; itemId: string; liked: boolean },
  log: Logger,
): Promise<SetLikeResult> {
  const l = log.child({ fn: 'setLike', profileId: input.profileId, itemId: input.itemId })
  try {
    const item = await db
      .selectFrom('item')
      .select('id')
      .where('id', '=', input.itemId)
      .where('status', '=', ItemStatus.rendered)
      .executeTakeFirst()
    if (!item) {
      l.info('like target not found or not visible')
      return { status: 'not_found' }
    }

    let affected: bigint
    if (input.liked) {
      const res = await db
        .insertInto('like')
        .values({ profile_id: input.profileId, item_id: input.itemId })
        .onConflict((oc) => oc.columns(['profile_id', 'item_id']).doNothing())
        .executeTakeFirst()
      affected = res.numInsertedOrUpdatedRows ?? 0n
    } else {
      const res = await db
        .deleteFrom('like')
        .where('profile_id', '=', input.profileId)
        .where('item_id', '=', input.itemId)
        .executeTakeFirst()
      affected = res.numDeletedRows
    }

    const count = await db
      .selectFrom('like')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('item_id', '=', input.itemId)
      .executeTakeFirstOrThrow()

    const outcome = likeOutcome(input.liked, affected)
    l.info({ ...outcome }, 'like applied')
    return { status: 'ok', ...outcome, likeCount: Number(count.n) }
  } catch (err) {
    l.error(errorFields(err), 'like failed')
    throw err
  }
}
