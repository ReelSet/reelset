import { z } from 'zod'

export const likeBodySchema = z.object({ itemId: z.guid(), liked: z.boolean() })

export type LikeOutcome = { liked: boolean; changed: boolean }

export function likeOutcome(liked: boolean, affectedRows: bigint | number): LikeOutcome {
  return { liked, changed: BigInt(affectedRows) > 0n }
}
