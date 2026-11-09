import { z } from 'zod'

export const HISTORY_PAGE_SIZE = 20

export type HistoryEntry = {
  id: string
  question: string
  preview: string
  turns: number
  lastAt: string
}

export type HistoryPage = { entries: HistoryEntry[]; nextCursor: string | null }

export type DaySection<T extends { lastAt: string }> = { key: string; label: string; entries: T[] }

export const historyQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
})

export const deleteBodySchema = z.object({ id: z.guid() })

export type HistoryCursor = { at: string; key: string }

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeHistoryCursor(raw: string | null | undefined): HistoryCursor | null {
  if (!raw) return null
  try {
    const parsed = z
      .object({ at: z.iso.datetime(), key: z.guid() })
      .safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function dayLabel(date: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - that.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: diffDays < 7 ? 'long' : undefined,
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export function groupByDay<T extends { lastAt: string }>(
  entries: readonly T[],
  now: Date,
): DaySection<T>[] {
  const sections: DaySection<T>[] = []
  for (const entry of entries) {
    const date = new Date(entry.lastAt)
    const key = dayKey(date)
    const last = sections[sections.length - 1]
    if (last && last.key === key) last.entries.push(entry)
    else sections.push({ key, label: dayLabel(date, now), entries: [entry] })
  }
  return sections
}
