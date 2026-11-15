import { hiddenReasonSchema } from '@reelset/core'
import { z } from 'zod'

export const VISIBILITY_FILTERS = ['public', 'hidden', 'private', 'suspected'] as const
export type VisibilityFilter = (typeof VISIBILITY_FILTERS)[number]

export const VISIBILITY_FILTER_LABELS: Record<VisibilityFilter, string> = {
  public: 'Public',
  hidden: 'Hidden',
  private: 'Private (requested)',
  suspected: 'Suspected spam',
}

export const BULK_HIDE_LIMIT = 200
export const SPAM_SCAN_LIMIT = 1000

export const hideInputSchema = z.object({
  itemIds: z.array(z.guid()).min(1).max(BULK_HIDE_LIMIT),
  reason: hiddenReasonSchema,
})

export const unhideInputSchema = hideInputSchema.pick({ itemIds: true })

export function parseVisibilityFilter(raw: string | string[] | undefined): VisibilityFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return VISIBILITY_FILTERS.find((filter) => filter === value) ?? null
}

export function formDataStrings(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((value): value is string => typeof value === 'string')
}
