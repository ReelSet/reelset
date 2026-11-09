import { ItemStatus } from '../db/enums'

/*
 * found ─► summarized ─► embedded ─► voiced ─► rendered   (only `rendered` is visible in the feed)
 *   │          │             │          │
 *   ├─► insufficient_source  └──────────┴─► failed ─► back to any pipeline stage (admin Retry)
 *   └─► failed
 *
 * rendered ─► found is a full reprocess. A new reel for changed prompts or templates is a new
 * row in `render` and does not change item status, so the item stays in the feed meanwhile.
 */
const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  found: [ItemStatus.summarized, ItemStatus.insufficient_source, ItemStatus.failed],
  summarized: [ItemStatus.embedded, ItemStatus.failed],
  embedded: [ItemStatus.voiced, ItemStatus.failed],
  voiced: [ItemStatus.rendered, ItemStatus.failed],
  rendered: [ItemStatus.found],
  insufficient_source: [ItemStatus.found],
  failed: [ItemStatus.found, ItemStatus.summarized, ItemStatus.embedded, ItemStatus.voiced],
}

export const PIPELINE_STAGES = [
  ItemStatus.found,
  ItemStatus.summarized,
  ItemStatus.embedded,
  ItemStatus.voiced,
  ItemStatus.rendered,
] as const

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ItemStatus,
    readonly to: ItemStatus,
  ) {
    super(`invalid item status transition: ${from} -> ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: ItemStatus, to: ItemStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}

export function nextStage(status: ItemStatus): ItemStatus | null {
  const index = PIPELINE_STAGES.indexOf(status as (typeof PIPELINE_STAGES)[number])
  if (index === -1 || index === PIPELINE_STAGES.length - 1) return null
  return PIPELINE_STAGES[index + 1] ?? null
}

export function isVisibleInFeed(status: ItemStatus): boolean {
  return status === ItemStatus.rendered
}
