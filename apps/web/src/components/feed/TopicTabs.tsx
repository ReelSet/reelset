'use client'

import { SearchIcon } from '@/components/ui/icons'
import type { FeedTab } from '@/lib/feed-tabs'
import { topicLabel } from '@/lib/seo/site'

type Props = {
  tabs: FeedTab[]
  /** Slug of the topic feed on screen, null for "For you". */
  active: string | null
  onSelect: (slug: string | null) => void
}

/** Translucent tab row over the top of the reel: For you, a few topics, and search. */
export function TopicTabs({ tabs, active, onSelect }: Props) {
  const shown =
    active && !tabs.some((t) => t.slug === active)
      ? [{ slug: active, label: topicLabel(active.replace(/-/g, ' ')) }, ...tabs]
      : tabs
  const all = [{ slug: null as string | null, label: 'For you' }, ...shown]

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center bg-gradient-to-b from-black/65 to-transparent pb-5 pl-2 pr-1 pt-safe">
      <div
        role="tablist"
        aria-label="Feed"
        className="no-scrollbar pointer-events-auto flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {all.map((tab) => {
          const selected = tab.slug === active
          return (
            <button
              key={tab.slug ?? 'for-you'}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => !selected && onSelect(tab.slug)}
              className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-[15px] font-semibold transition ${
                selected ? 'text-white' : 'text-white/60 hover:text-white/85'
              }`}
            >
              {tab.label}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-accent transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}
              />
            </button>
          )
        })}
      </div>
      <a
        href="/ask"
        aria-label="Search and ask"
        className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center text-white transition active:scale-90"
      >
        <SearchIcon className="h-[22px] w-[22px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]" />
      </a>
    </div>
  )
}
