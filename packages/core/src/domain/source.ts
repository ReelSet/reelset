import { z } from 'zod'
import { Source } from '../db/enums'
import type { Logger } from '../lib/logger'

export const SOURCES = Object.values(Source) as [Source, ...Source[]]

export const sourceSchema = z.enum(SOURCES)

export function parseSource(value: unknown, log: Logger): Source | null {
  const parsed = sourceSchema.safeParse(value)
  if (parsed.success) return parsed.data
  log.warn({ value: String(value).slice(0, 64) }, 'unknown source rejected')
  return null
}
