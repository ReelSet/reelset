'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupByDay, type HistoryEntry, type HistoryPage } from '@/lib/ask/history'
import { ClockIcon } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { DeleteConversation } from './DeleteConversation'

type Phase = 'loading' | 'ready' | 'error'

export function AskHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)

  const load = useCallback(async (after: string | null) => {
    const res = await fetch(
      `/api/ask/history${after ? `?cursor=${encodeURIComponent(after)}` : ''}`,
    )
    if (res.status === 401) {
      const body = (await res.json()) as { loginUrl: string }
      window.location.assign(body.loginUrl)
      return null
    }
    if (!res.ok) throw new Error(String(res.status))
    return (await res.json()) as HistoryPage
  }, [])

  const loadFirst = useCallback(async () => {
    setPhase('loading')
    try {
      const page = await load(null)
      if (!page) return
      setEntries(page.entries)
      setCursor(page.nextCursor)
      setPhase('ready')
    } catch {
      setPhase('error')
    }
  }, [load])

  useEffect(() => {
    void loadFirst()
  }, [loadFirst])

  async function loadMore() {
    if (!cursor || moreBusy) return
    setMoreBusy(true)
    setMoreFailed(false)
    try {
      const page = await load(cursor)
      if (!page) return
      setEntries((cur) => {
        const seen = new Set(cur.map((e) => e.id))
        return [...cur, ...page.entries.filter((e) => !seen.has(e.id))]
      })
      setCursor(page.nextCursor)
    } catch {
      setMoreFailed(true)
    } finally {
      setMoreBusy(false)
    }
  }

  const sections = useMemo(() => groupByDay(entries, new Date()), [entries])

  if (phase === 'loading') {
    return (
      <div aria-busy aria-label="Loading your questions" className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[76px] w-full" />
        ))}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <ErrorState
        title="Could not load your questions"
        body="Check your connection and try again."
        onRetry={() => void loadFirst()}
        retryLabel="Retry"
      />
    )
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ClockIcon className="h-8 w-8" />}
        title="No questions yet"
        body="Answers you get in Ask are kept here so you can reopen them."
        action={
          <a
            href="/ask"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
          >
            Ask something
          </a>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-7">
      {sections.map((section) => (
        <section key={section.key}>
          <h2 className="mb-2.5 text-xs font-medium uppercase tracking-wider text-faint">
            {section.label}
          </h2>
          <ul className="flex flex-col gap-2">
            {section.entries.map((e) => (
              <li
                key={e.id}
                className="animate-fade-up group flex items-start gap-1 rounded-md border border-line bg-surface transition hover:border-line-strong"
              >
                <a href={`/ask/${e.id}`} className="min-w-0 flex-1 p-3.5 active:opacity-80">
                  <span className="line-clamp-2 text-[15px] font-medium leading-snug">
                    {e.question}
                  </span>
                  <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">
                    {e.preview}
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-xs text-faint">
                    <time dateTime={e.lastAt}>
                      {new Date(e.lastAt).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                    {e.turns > 1 && <span>{e.turns} questions</span>}
                  </span>
                </a>
                <div className="p-2">
                  <DeleteConversation
                    id={e.id}
                    onDeleted={() => setEntries((cur) => cur.filter((x) => x.id !== e.id))}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {cursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={moreBusy}
            className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm text-muted transition hover:bg-raised hover:text-fg active:scale-95"
          >
            {moreBusy && <Spinner />}
            {moreFailed ? 'Could not load more. Retry' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
