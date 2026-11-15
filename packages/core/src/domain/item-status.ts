import { ItemStatus } from '../db/enums'

/*
 * found ─► summarized ─► embedded ─► voiced ─► rendered   (only `rendered` is visible in the feed)
 *   │          │             │          │
 *   ├─► insufficient_source  └──────────┴─► failed ─► back to any pipeline stage (admin Retry)
 *   ├─► source_only   (the gate judged it not worth a reel: no script, no render, still citable)
 *   └─► failed
 *
 * rendered ─► found is a full reprocess. A new reel for changed prompts or templates is a new
 * row in `render` and does not change item status, so the item stays in the feed meanwhile.
 * source_only ─► found is the admin override that sends the item back to become a reel.
 */
const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  found: [
    ItemStatus.summarized,
    ItemStatus.insufficient_source,
    ItemStatus.source_only,
    ItemStatus.failed,
  ],
  summarized: [ItemStatus.embedded, ItemStatus.failed],
  embedded: [ItemStatus.voiced, ItemStatus.failed],
  voiced: [ItemStatus.rendered, ItemStatus.failed],
  rendered: [ItemStatus.found],
  insufficient_source: [ItemStatus.found],
  source_only: [ItemStatus.found],
  failed: [ItemStatus.found, ItemStatus.summarized, ItemStatus.embedded, ItemStatus.voiced],
}

export const PIPELINE_STAGES = [
  ItemStatus.found,
  ItemStatus.summarized,
  ItemStatus.embedded,
  ItemStatus.voiced,
  ItemStatus.rendered,
] as const

/** Statuses the pipeline will not advance on its own; only an admin action moves an item out. */
export const SETTLED_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.rendered,
  ItemStatus.source_only,
  ItemStatus.insufficient_source,
  ItemStatus.failed,
]

/** Settled statuses that mean something went wrong; `source_only` and `rendered` are healthy ends. */
export const UNHEALTHY_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.insufficient_source,
  ItemStatus.failed,
]

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

export function isSettledStatus(status: ItemStatus): boolean {
  return SETTLED_ITEM_STATUSES.includes(status)
}
