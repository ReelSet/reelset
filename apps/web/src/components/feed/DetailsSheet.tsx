'use client'

import { useEffect, useRef, useState } from 'react'
import {
  FactsSection,
  SourcesSection,
  TldrSection,
  TranscriptSection,
} from '@/components/seo/reel-sections'
import { CloseIcon } from '@/components/ui/icons'
import type { FeedItemDto } from '@/lib/api-types'
import type { ReelPageData } from '@/lib/seo/types'
import { useReelDetails } from './useReelDetails'

type TabKey = 'tldr' | 'facts' | 'sources' | 'transcript'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tldr', label: 'TL;DR' },
  { key: 'facts', label: 'Key facts' },
  { key: 'sources', label: 'Sources' },
  { key: 'transcript', label: 'Transcript' },
]

const HALF = 0.52
const FULL = 0.88
const CLOSE_BELOW = HALF * 0.6

/** What the feed already carries, so the sheet is useful before /api/reel/[id] answers. */
function fromItem(item: FeedItemDto): ReelPageData {
  return {
    id: item.id,
    title: item.title,
    tldr: item.tldr,
    hook: null,
    transcript: item.transcript,
    topics: item.topics,
    kind: item.kind,
    canonicalUrl: item.canonicalUrl,
    publishedAt: item.publishedAt,
    renderedAt: null,
    videoUrl: item.videoUrl,
    posterUrl: item.posterUrl,
    durationMs: item.durationMs,
    facts: [],
    mentions: item.mentions.map((m) => ({
      source: m.source,
      url: m.url,
      title: null,
      author: null,
      score: m.score,
      comments: null,
    })),
  }
}

/** Mobile details sheet: half height with the video playing above, drag the handle to resize. */
export function DetailsSheet({ item, onClose }: { item: FeedItemDto; onClose: () => void }) {
  const loaded = useReelDetails(item.id)
  const reel = loaded ?? fromItem(item)
  const [tab, setTab] = useState<TabKey>('tldr')
  const [snap, setSnap] = useState<'half' | 'full'>('half')
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const drag = useRef<{ y: number; base: number; box: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [tab, item.id])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const box = boxRef.current?.offsetHeight ?? 0
    if (!box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, base: snap === 'full' ? FULL : HALF, box }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const ratio = d.base - (e.clientY - d.y) / d.box
    setDragRatio(Math.min(FULL, Math.max(0, ratio)))
  }

  function onPointerEnd() {
    const d = drag.current
    drag.current = null
    if (!d || dragRatio === null) return
    if (dragRatio < CLOSE_BELOW) return onClose()
    setSnap(dragRatio > (HALF + FULL) / 2 ? 'full' : 'half')
    setDragRatio(null)
  }

  const ratio = dragRatio ?? (snap === 'full' ? FULL : HALF)
  const empty = (text: string) => <p className="text-sm text-faint">{text}</p>

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-0 z-50 flex flex-col justify-end"
    >
      <div
        role="dialog"
        aria-label="Reel details"
        style={{ height: `${ratio * 100}%` }}
        className={`animate-sheet-up pointer-events-auto flex flex-col rounded-t-[28px] border-t border-line bg-surface/95 shadow-[0_-12px_40px_-12px_rgba(0,0,0,.7)] backdrop-blur-xl ${dragRatio === null ? 'transition-[height] duration-300 ease-out' : ''}`}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className="shrink-0 cursor-grab touch-none select-none px-5 pt-2.5 active:cursor-grabbing"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-white/20" />
          <div className="mt-3 flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{item.title}</p>
            <button
              type="button"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close details"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-muted transition hover:text-fg active:scale-90"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Reel details"
            className="no-scrollbar -mx-1 mt-2 flex overflow-x-auto"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setTab(t.key)}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
                  tab === t.key ? 'border-accent text-fg' : 'border-transparent text-faint'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="-mx-5 h-px bg-line" />
        </div>

        <div
          ref={scrollRef}
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 text-sm leading-relaxed text-muted"
        >
          {tab === 'tldr' &&
            (reel.tldr ? (
              <TldrSection reel={reel} idPrefix="sheet-" />
            ) : (
              empty('No summary for this reel yet.')
            ))}
          {tab === 'facts' &&
            (reel.facts.length > 0 ? (
              <FactsSection reel={reel} idPrefix="sheet-" />
            ) : (
              empty(loaded ? 'No key facts for this reel.' : 'Loading key facts...')
            ))}
          {tab === 'sources' && <SourcesSection reel={reel} idPrefix="sheet-" />}
          {tab === 'transcript' &&
            (reel.transcript ? (
              <TranscriptSection reel={reel} idPrefix="sheet-" />
            ) : (
              empty('No transcript for this reel.')
            ))}
        </div>
      </div>
    </div>
  )
}
