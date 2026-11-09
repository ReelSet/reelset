import {
  SETTINGS,
  errorFields,
  getSetting,
  renderKey,
  type AlertInput,
  type Database,
  type Logger,
} from '@reelset/core'
import {
  DEAD_LETTER_WINDOW_MS,
  FAILURE_RATE_WINDOW_MS,
  ORPHAN_SCAN_PAGE_SIZE,
  RETENTION_BATCH_SIZE,
  STUCK_RENDER_MINUTES,
  TEMPLATE_VERSION,
  UPGRADE_BATCH_SIZE,
  UPGRADE_CANDIDATE_LIMIT,
  UPGRADE_IN_FLIGHT_TARGET,
  UPGRADE_PENDING_TTL_MS,
} from './constants'
import { REELS_PREFIX } from './keys'
import {
  deadLetterGrowing,
  failureRateExceeded,
  findOrphanKeys,
  prioritizeUpgrades,
  retentionCutoff,
  stuckCutoff,
  upgradeBatchSize,
} from './plan'
import type { MaintenanceStore } from './store'

export type MaintenanceDeps = {
  store: MaintenanceStore
  media: Pick<R2Bucket, 'list' | 'delete'>
  alert: (input: AlertInput) => Promise<unknown>
  retentionDays: () => Promise<number>
  upgrade?: { voice: string; send: (itemIds: string[]) => Promise<void> }
  log: Logger
  now?: () => Date
}

async function step(name: string, log: Logger, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    log.error({ step: name, ...errorFields(err) }, 'maintenance step failed')
  }
}

export async function runMaintenance(deps: MaintenanceDeps): Promise<void> {
  const log = deps.log.child({ job: 'maintenance' })
  const now = deps.now?.() ?? new Date()
  log.info('maintenance started')
  await step('stuck', log, () => failStuck(deps, now, log))
  await step('orphans', log, () => cleanOrphans(deps, now, log))
  await step('retention', log, () => applyRetention(deps, now, log))
  await step('upgrade', log, () => upgradeTemplates(deps, log, now))
  await step('alerts', log, () => checkAlerts(deps, now, log))
  log.info('maintenance finished')
}

export async function failStuck(deps: MaintenanceDeps, now: Date, log: Logger): Promise<number> {
  const stuck = await deps.store.failStuckRenders(stuckCutoff(now, STUCK_RENDER_MINUTES))
  if (stuck.length > 0) {
    log.warn({ count: stuck.length, itemIds: stuck.map((s) => s.itemId) }, 'failed stuck renders')
  }
  return stuck.length
}

export async function cleanOrphans(deps: MaintenanceDeps, now: Date, log: Logger): Promise<number> {
  const cursor = (await deps.store.getOrphanCursor()) ?? undefined
  const page = await deps.media.list({ prefix: REELS_PREFIX, limit: ORPHAN_SCAN_PAGE_SIZE, cursor })
  const objects = page.objects.map((o) => ({ key: o.key, uploaded: o.uploaded }))
  const done = await deps.store.doneKeys(objects.map((o) => o.key))
  const orphans = findOrphanKeys(objects, done, now)
  if (orphans.length > 0) {
    await deps.media.delete(orphans)
    log.warn({ count: orphans.length, scanned: objects.length }, 'deleted orphaned r2 objects')
  }
  await deps.store.setOrphanCursor(page.truncated ? page.cursor : null)
  log.info({ scanned: objects.length, truncated: page.truncated }, 'orphan scan page done')
  return orphans.length
}

export async function applyRetention(
  deps: MaintenanceDeps,
  now: Date,
  log: Logger,
): Promise<number> {
  const days = await deps.retentionDays()
  const expired = await deps.store.expiredRenders(retentionCutoff(now, days), RETENTION_BATCH_SIZE)
  if (expired.length === 0) return 0
  const keys = expired.flatMap((r) => [r.videoKey, r.posterKey]).filter((k): k is string => !!k)
  await deps.media.delete(keys)
  await deps.store.clearRenderKeys(expired.map((r) => r.id))
  log.info(
    { renders: expired.length, objects: keys.length, retentionDays: days },
    'retention applied',
  )
  return expired.length
}

export async function checkAlerts(deps: MaintenanceDeps, now: Date, log: Logger): Promise<void> {
  const counts = await deps.store.renderCountsSince(
    new Date(now.getTime() - FAILURE_RATE_WINDOW_MS),
  )
  if (failureRateExceeded(counts)) {
    log.error(counts, 'render failure rate high')
    await deps.alert({
      key: 'render_failure_rate_high',
      message: 'More than 20% of renders failed in the last hour',
      fields: { total: counts.total, failed: counts.failed },
    })
  }

  const deadLettered = await deps.store.deadLetteredSince(
    new Date(now.getTime() - DEAD_LETTER_WINDOW_MS),
  )
  if (deadLetterGrowing(deadLettered)) {
    await deps.alert({
      key: 'dead_letter_growing',
      message: 'Render jobs are landing in the dead-letter queue',
      fields: { lastHour: deadLettered },
    })
  }
}

/** Tops re-renders up to a bounded in-flight count so new items are never starved. */
export async function upgradeTemplates(
  deps: MaintenanceDeps,
  log: Logger,
  now: Date = new Date(),
): Promise<number> {
  const upgrade = deps.upgrade
  if (!upgrade) return 0
  const [rendering, pendingNew, sentBefore] = await Promise.all([
    deps.store.activeRenderCount(),
    deps.store.pendingNewItemCount(),
    deps.store.getUpgradeSent(),
  ])
  const recent = sentBefore.filter((s) => now.getTime() - s.at < UPGRADE_PENDING_TTL_MS)
  const minTemplate = await deps.store.feedMinTemplate()
  const candidates = prioritizeUpgrades(
    await deps.store.renderedForUpgrade(UPGRADE_CANDIDATE_LIMIT),
    minTemplate,
    now,
  )
  const keyed = await Promise.all(
    candidates.map(async (c) => ({
      id: c.id,
      key: await renderKey({
        itemId: c.id,
        contentHash: c.contentHash,
        promptVersion: c.promptVersion,
        templateVersion: TEMPLATE_VERSION,
        voice: upgrade.voice,
      }),
    })),
  )
  const existing = await deps.store.existingRenderKeys(keyed.map((k) => k.key))
  const stale = keyed.filter((k) => !existing.has(k.key))
  const staleIds = new Set(stale.map((k) => k.id))
  const pending = recent.filter((s) => staleIds.has(s.id))
  const size = upgradeBatchSize({
    target: UPGRADE_IN_FLIGHT_TARGET,
    rendering,
    pendingUpgrades: pending.length,
    pendingNew,
    cap: UPGRADE_BATCH_SIZE,
  })
  const pendingIds = new Set(pending.map((s) => s.id))
  const batch = stale
    .filter((k) => !pendingIds.has(k.id))
    .slice(0, size)
    .map((k) => k.id)
  if (batch.length > 0) {
    await upgrade.send(batch)
    await deps.store.setUpgradeSent([...pending, ...batch.map((id) => ({ id, at: now.getTime() }))])
  }
  log.info(
    {
      queued: batch.length,
      rendering,
      pendingUpgrades: pending.length,
      pendingNew,
      remaining: stale.length - pending.length - batch.length,
      templateVersion: TEMPLATE_VERSION,
      feedMinTemplate: minTemplate,
      hiddenInFeed: candidates.filter((c) => c.bestTemplate < minTemplate).length,
    },
    'template upgrade sweep',
  )
  return batch.length
}

export async function loadRetentionDays(db: Database, log: Logger): Promise<number> {
  return getSetting(db, SETTINGS.reelRetentionDays, log)
}
