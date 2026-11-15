import { errorFields, type Logger } from '@reelset/core'
import { after } from 'next/server'

/** Runs best-effort work after the response; falls back to fire-and-forget outside a request scope. */
export function runAfterResponse(task: () => Promise<void>, log: Logger): void {
  const guarded = async () => {
    try {
      await task()
    } catch (err) {
      log.warn(errorFields(err), 'background task failed')
    }
  }
  try {
    after(guarded)
  } catch {
    void guarded()
  }
}
