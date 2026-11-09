import { ItemStatus } from '@reelset/core'
import { z } from 'zod'

export const RETRY_STAGES = [ItemStatus.found, ItemStatus.summarized, ItemStatus.embedded] as const

export type RetryStage = (typeof RETRY_STAGES)[number]

export const RENDER_RETRY_STAGE: RetryStage = ItemStatus.embedded

export const itemRetrySchema = z.object({
  itemId: z.guid(),
  stage: z.enum(RETRY_STAGES),
})

export const DISCARD_META_KEY = 'adminDiscard'

export const idSchema = z.object({ id: z.guid() })

// No worker re-enqueues `voiced` items, so a failure after voicing restarts from `embedded`.
export function suggestRetryStage(lastOkStage: string | null | undefined): RetryStage {
  if (lastOkStage === ItemStatus.voiced) return ItemStatus.embedded
  return RETRY_STAGES.find((stage) => stage === lastOkStage) ?? ItemStatus.found
}

// Redirect targets come from a hidden form field, so only same-site admin paths are accepted.
export function safeAdminPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/admin'
  if (!/^\/admin(\/[a-z-]*)?(\?[A-Za-z0-9=&%._-]*)?$/.test(raw)) return '/admin'
  return raw
}

export function withFlash(path: string, kind: 'ok' | 'error', message: string): string {
  const [base = '/admin', query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.set('flash', `${kind}:${message.slice(0, 160)}`)
  return `${base}?${params.toString()}`
}

export function parseFlash(
  raw: string | string[] | undefined,
): { kind: 'ok' | 'error'; message: string } | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  const index = value.indexOf(':')
  if (index === -1) return null
  const kind = value.slice(0, index)
  if (kind !== 'ok' && kind !== 'error') return null
  return { kind, message: value.slice(index + 1) }
}
