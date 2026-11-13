'use client'

import { useState } from 'react'
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

/** Desktop details panel: one tab at a time instead of a long scroll. Every tab stays in the DOM. */
export function ReelPanel({ reel }: { reel: ReelPageData }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'tldr', label: 'TL;DR' },
    ...(reel.facts.length > 0 ? [{ key: 'facts' as const, label: 'Facts' }] : []),
    ...(reel.transcript ? [{ key: 'transcript' as const, label: 'Transcript' }] : []),
  ]
  const [active, setActive] = useState<TabKey>('tldr')

  return (
    <article className="flex flex-col gap-4 text-sm leading-relaxed text-muted">
      <ReelHeader reel={reel} />
      <div role="tablist" aria-label="Reel details" className="flex gap-1 border-b border-line">
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
      <div
        role="tabpanel"
        id="panel-tldr"
        aria-labelledby="panel-tab-tldr"
        hidden={active !== 'tldr'}
        className="flex flex-col gap-5"
      >
        <TldrSection reel={reel} idPrefix="panel-" />
        <SourcesSection reel={reel} idPrefix="panel-" />
      </div>
      <div
        role="tabpanel"
        id="panel-facts"
        aria-labelledby="panel-tab-facts"
        hidden={active !== 'facts'}
      >
        <FactsSection reel={reel} idPrefix="panel-" />
      </div>
      <div
        role="tabpanel"
        id="panel-transcript"
        aria-labelledby="panel-tab-transcript"
        hidden={active !== 'transcript'}
      >
        <TranscriptSection reel={reel} idPrefix="panel-" />
      </div>
      <TopicsNav reel={reel} />
    </article>
  )
}
