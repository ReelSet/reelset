import { z } from 'zod'
import { topicsBodySchema } from './topics'

export const PROFILE_SOURCES = ['hn', 'github', 'reddit', 'youtube', 'papers', 'news'] as const
export type ProfileSource = (typeof PROFILE_SOURCES)[number]

export const sourcesSchema = z.object({
  sources: z.array(z.enum(PROFILE_SOURCES)).min(1).max(PROFILE_SOURCES.length),
})

export const topicsSchema = topicsBodySchema

// An empty stored list means "every source", so new sources appear for existing users.
export function storedSources(selected: readonly string[]): string[] {
  const unique = [...new Set(selected)].filter((s): s is ProfileSource =>
    (PROFILE_SOURCES as readonly string[]).includes(s),
  )
  return unique.length === 0 || unique.length === PROFILE_SOURCES.length ? [] : unique
}

export function enabledSources(stored: readonly string[]): ProfileSource[] {
  const known = stored.filter((s): s is ProfileSource =>
    (PROFILE_SOURCES as readonly string[]).includes(s),
  )
  return known.length === 0
    ? [...PROFILE_SOURCES]
    : PROFILE_SOURCES.filter((s) => known.includes(s))
}
