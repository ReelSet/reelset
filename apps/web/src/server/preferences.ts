import { errorFields, type Database, type Logger } from '@reelset/core'
import { sourcesSchema, storedSources, topicsSchema } from '@/lib/preferences'

export type SaveResult<T> = { ok: true; value: T } | { ok: false; error: 'invalid' }

export async function saveTopics(
  db: Database,
  profileId: string,
  input: unknown,
  log: Logger,
): Promise<SaveResult<string[]>> {
  const parsed = topicsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const topics = [...new Set(parsed.data.topics)]
  try {
    await db
      .updateTable('profile')
      .set({ topics, updated_at: new Date() })
      .where('id', '=', profileId)
      .execute()
    log.info({ profileId, count: topics.length }, 'topics saved')
    return { ok: true, value: topics }
  } catch (err) {
    log.error(errorFields(err), 'topics save failed')
    throw err
  }
}

export async function saveSources(
  db: Database,
  profileId: string,
  input: unknown,
  log: Logger,
): Promise<SaveResult<string[]>> {
  const parsed = sourcesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const sources = storedSources(parsed.data.sources)
  try {
    await db
      .updateTable('profile')
      .set({ sources, updated_at: new Date() })
      .where('id', '=', profileId)
      .execute()
    log.info({ profileId, sources: sources.length === 0 ? 'all' : sources }, 'sources saved')
    return { ok: true, value: parsed.data.sources }
  } catch (err) {
    log.error(errorFields(err), 'sources save failed')
    throw err
  }
}
