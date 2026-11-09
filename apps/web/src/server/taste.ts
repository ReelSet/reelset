import { elapsedMs, errorFields, type Database, type Logger } from '@reelset/core'
import { loadTasteSignals, storeTaste } from '@/lib/ranking/sql'
import { tasteVector } from '@/lib/ranking/taste'

export async function recomputeTaste(
  db: Database,
  profileId: string,
  log: Logger,
): Promise<{ signalCount: number }> {
  const started = performance.now()
  const l = log.child({ fn: 'recomputeTaste', profileId })
  try {
    const signals = await loadTasteSignals(db, profileId)
    const taste = tasteVector(signals)
    const signalCount = taste ? signals.length : 0
    await storeTaste(db, profileId, taste, signalCount)
    l.info(
      { signalCount, hasTaste: taste !== null, durationMs: elapsedMs(started) },
      'taste stored',
    )
    return { signalCount }
  } catch (err) {
    l.error(errorFields(err), 'taste recompute failed')
    throw err
  }
}

export function scheduleTasteRecompute(
  db: Database,
  profileId: string,
  log: Logger,
): Promise<void> {
  return recomputeTaste(db, profileId, log).then(
    () => undefined,
    () => undefined,
  )
}
