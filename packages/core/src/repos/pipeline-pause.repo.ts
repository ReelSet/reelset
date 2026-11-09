import type { Database } from '../db/client'
import type { Logger } from '../lib/logger'
import { SETTINGS, getSetting, setSetting, type PipelinePause } from './settings.repo'

export const PIPELINE_PROBE_MINUTES = 15

export async function getPipelinePause(db: Database, log: Logger): Promise<PipelinePause | null> {
  return getSetting(db, SETTINGS.pipelinePaused, log)
}

/**
 * Pauses LLM-dependent stages after a provider quota/billing error. An existing pause keeps its
 * original `since` and only moves `until` (the next probe time).
 */
export async function pausePipeline(
  db: Database,
  reason: string,
  log: Logger,
  now = new Date(),
  probeMinutes = PIPELINE_PROBE_MINUTES,
): Promise<{ pause: PipelinePause; created: boolean }> {
  const existing = await getPipelinePause(db, log)
  const pause: PipelinePause = {
    reason: reason.slice(0, 300),
    since: existing?.since ?? now.toISOString(),
    until: new Date(now.getTime() + probeMinutes * 60_000).toISOString(),
  }
  await setSetting(db, SETTINGS.pipelinePaused, pause, log)
  if (!existing) log.error({ reason: pause.reason, until: pause.until }, 'pipeline paused')
  return { pause, created: !existing }
}

export async function clearPipelinePause(db: Database, log: Logger): Promise<boolean> {
  const existing = await getPipelinePause(db, log)
  if (!existing) return false
  await setSetting(db, SETTINGS.pipelinePaused, null, log)
  log.info({ since: existing.since }, 'pipeline unpaused')
  return true
}
