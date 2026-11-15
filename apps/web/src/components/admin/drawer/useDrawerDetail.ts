'use client'

import { useCallback, useEffect, useState } from 'react'
import { DetailError, type DetailStore } from './detail-store'

export type DrawerDetail<T> = { data: T | null; error: DetailError | null; retry: () => void }

function toDetailError(err: unknown): DetailError {
  return err instanceof DetailError ? err : new DetailError(0, 'network error')
}

/** Cached detail for id: shows stale data immediately and revalidates when refreshKey changes. */
export function useDrawerDetail<T>(
  store: DetailStore<T>,
  id: string,
  refreshKey: number,
): DrawerDetail<T> {
  const [result, setResult] = useState<{ id: string; error: DetailError | null } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (store.isFresh(id)) return
    const controller = new AbortController()
    store.load(id, controller.signal).then(
      () => setResult({ id, error: null }),
      (err: unknown) => {
        if (!controller.signal.aborted) setResult({ id, error: toDetailError(err) })
      },
    )
    return () => controller.abort()
  }, [store, id, refreshKey, attempt])

  const retry = useCallback(() => {
    setResult(null)
    setAttempt((n) => n + 1)
  }, [])

  const data = store.peek(id) ?? null
  const error = data === null && result?.id === id ? result.error : null
  return { data, error, retry }
}
