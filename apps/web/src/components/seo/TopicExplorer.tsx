'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ReelGrid } from '@/components/seo/Browse'
import { CloseIcon, SearchIcon } from '@/components/ui/icons'
import { filterHref, matchesQuery } from '@/lib/seo/browse'
import type { ReelSummary, TopicCount } from '@/lib/seo/types'

const MAX_RESULTS = 60

type Props = {
  topics: TopicCount[]
  reels: ReelSummary[]
  source: string | null
  /** Source chips, rendered on the server and stuck under the search field. */
  filters: ReactNode
  /** Server-rendered shelves, shown while the search field is empty. */
  children: ReactNode
}

/** Sticky search over topics and reels; an empty query shows the server-rendered content. */
export function TopicExplorer({ topics, reels, source, filters, children }: Props) {
  const [query, setQuery] = useState('')
  const q = query.trim()

  const results = useMemo(() => {
    if (!q) return null
    const needle = q.toLowerCase()
    return {
      topics: topics.filter((t) => t.label.toLowerCase().includes(needle)).slice(0, 12),
      reels: reels.filter((r) => matchesQuery(r, q)).slice(0, MAX_RESULTS),
    }
  }, [q, topics, reels])

  return (
    <>
      <div className="sticky top-0 z-20 -mx-5 mt-6 border-b border-line bg-bg/85 px-5 pb-3 pt-3 backdrop-blur-md">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics and reels"
            aria-label="Search topics and reels"
            enterKeyHint="search"
            autoComplete="off"
            className="h-11 w-full rounded-full border border-line bg-raised pl-11 pr-11 text-[15px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted transition hover:text-fg active:scale-95"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </form>
        <div className="mt-3">{filters}</div>
      </div>

      {results === null ? (
        children
      ) : (
        <section aria-live="polite" className="mt-6">
          {results.topics.length > 0 && (
            <ul className="mb-6 flex flex-wrap gap-2">
              {results.topics.map((t) => (
                <li key={t.slug}>
                  <a
                    href={filterHref(`/t/${t.slug}`, source)}
                    className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg active:scale-95"
                  >
                    {t.label}
                    <span className="text-xs text-faint tabular-nums">{t.count}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {results.reels.length > 0 ? (
            <ReelGrid reels={results.reels} scope={{ source }} />
          ) : (
            results.topics.length === 0 && (
              <p className="rounded-lg border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
                Nothing matches &ldquo;{q}&rdquo;. Try a broader word.
              </p>
            )
          )}
        </section>
      )}
    </>
  )
}
