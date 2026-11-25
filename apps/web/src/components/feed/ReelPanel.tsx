'use client'

import { useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  FactsSection,
  ReelHeader,
  SourcesSection,
  TldrSection,
  TopicsNav,
  TranscriptSection,
} from '@/components/seo/reel-sections'
import type { ReelPageData } from '@/lib/seo/types'

type TabKey = 'tldr' | 'facts' | 'transcript'

const FACT_SKELETON_WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-2/3']

function FactsSkeleton() {
  return (
    <div role="status" aria-label="Loading key facts" className="flex flex-col gap-3">
      <Skeleton className="h-3 w-20" />
      {FACT_SKELETON_WIDTHS.map((width, i) => (
        <Skeleton key={i} className={`h-4 ${width}`} />
      ))}
    </div>
  )
}

/** Desktop details panel: one tab at a time. `factsPending` shows a skeleton where facts will load. */
export function ReelPanel({
  reel,
  factsPending = false,
}: {
  reel: ReelPageData
  factsPending?: boolean
}) {
  const hasFacts = reel.facts.length > 0
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'tldr', label: 'TL;DR' },
    ...(hasFacts || factsPending ? [{ key: 'facts' as const, label: 'Facts' }] : []),
    ...(reel.transcript ? [{ key: 'transcript' as const, label: 'Transcript' }] : []),
  ]
  const [selected, setSelected] = useState<TabKey>('tldr')
  const active = tabs.some((tab) => tab.key === selected) ? selected : 'tldr'
  const setActive = setSelected

  return (
    <article className="flex min-h-0 flex-col gap-4 text-sm leading-relaxed text-muted">
      <ReelHeader reel={reel} />
      <div
        role="tablist"
        aria-label="Reel details"
        className="flex shrink-0 gap-1 border-b border-line"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`panel-tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`panel-${tab.key}`}
            onClick={() => setActive(tab.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition ${
              active === tab.key
                ? 'border-accent text-fg'
                : 'border-transparent text-faint hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Inactive tabs hide with a class, not the `hidden` attribute: reader-mode extractors drop
          hidden-attribute nodes, and these hold the facts and transcript AI engines cite. */}
      <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
        <div
          role="tabpanel"
          id="panel-tldr"
          aria-labelledby="panel-tab-tldr"
          className={active === 'tldr' ? 'flex flex-col gap-5' : 'hidden'}
        >
          <TldrSection reel={reel} idPrefix="panel-" />
          <SourcesSection reel={reel} idPrefix="panel-" />
        </div>
        <div
          role="tabpanel"
          id="panel-facts"
          aria-labelledby="panel-tab-facts"
          className={active === 'facts' ? undefined : 'hidden'}
        >
          {factsPending ? <FactsSkeleton /> : <FactsSection reel={reel} idPrefix="panel-" />}
        </div>
        <div
          role="tabpanel"
          id="panel-transcript"
          aria-labelledby="panel-tab-transcript"
          className={active === 'transcript' ? undefined : 'hidden'}
        >
          <TranscriptSection reel={reel} idPrefix="panel-" />
        </div>
      </div>
      <div className="shrink-0">
        <TopicsNav reel={reel} />
      </div>
    </article>
  )
}
