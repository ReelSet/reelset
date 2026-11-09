import {
  clearPipelinePause,
  errorFields,
  getPipelinePause,
  pausePipeline,
  sendAlert,
  type Database,
  type Logger,
} from '@reelset/core'
import { HttpError } from '../http'

export class QuotaExhaustedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'QuotaExhaustedError'
  }
}

const QUOTA_BODY = /RESOURCE_EXHAUSTED|quota|billing|credit|prepay|insufficient/i

export function isQuotaHttpError(err: unknown): err is HttpError {
  if (!(err instanceof HttpError)) return false
  if (err.status === 402) return true
  if (err.status === 429 || err.status === 403) return QUOTA_BODY.test(err.body)
  return false
}

/** Rethrows provider quota/billing failures as QuotaExhaustedError so callers can pause, not fail. */
export function asQuotaError(err: unknown): unknown {
  if (!isQuotaHttpError(err)) return err
  const detail = err.body.replace(/\s+/g, ' ').slice(0, 160)
  return new QuotaExhaustedError(err.status, `Gemini HTTP ${err.status}: ${detail}`)
}

export async function pauseForQuota(
  db: Database,
  webhookUrl: string | undefined,
  err: QuotaExhaustedError,
  log: Logger,
): Promise<void> {
  const { pause } = await pausePipeline(db, err.message, log)
  await sendAlert(
    db,
    webhookUrl,
    {
      key: 'llm_quota_exhausted',
      message: 'LLM provider quota/billing exhausted, pipeline paused until a probe succeeds',
      fields: { status: err.status, since: pause.since, nextProbe: pause.until },
    },
    log,
  ).catch((e) => log.error(errorFields(e), 'quota alert failed'))
}

export type ProbeResult = 'not_paused' | 'not_due' | 'resumed' | 'still_paused'

/** Runs one cheap provider call once the pause window has elapsed; clears the pause on success. */
export async function probePause(
  db: Database,
  probe: (() => Promise<unknown>) | undefined,
  webhookUrl: string | undefined,
  log: Logger,
  now = new Date(),
): Promise<ProbeResult> {
  const pause = await getPipelinePause(db, log)
  if (!pause) return 'not_paused'
  if (!probe || now.getTime() < new Date(pause.until).getTime()) return 'not_due'
  try {
    await probe()
  } catch (raw) {
    const err = asQuotaError(raw)
    const reason = err instanceof Error ? err.message : String(err)
    log.warn({ reason }, 'quota probe failed, staying paused')
    await pausePipeline(db, reason, log, now)
    if (err instanceof QuotaExhaustedError) {
      await sendAlert(
        db,
        webhookUrl,
        {
          key: 'llm_quota_exhausted',
          message: 'LLM provider quota/billing still exhausted, pipeline remains paused',
          fields: { status: err.status, since: pause.since },
        },
        log,
      ).catch((e) => log.error(errorFields(e), 'quota alert failed'))
    }
    return 'still_paused'
  }
  await clearPipelinePause(db, log)
  return 'resumed'
}
