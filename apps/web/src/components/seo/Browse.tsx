import { ArrowRightIcon, EyeIcon } from '@/components/ui/icons'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { formatCount } from '@/lib/counts'
import { reelHref, type FeedScope } from '@/lib/reel-url'
import { clockDuration, filterHref, type Shelf, type SourceChip } from '@/lib/seo/browse'
import type { ReelSummary, TopicCount } from '@/lib/seo/types'

const MOBILE_SHELF_REELS = 4

export function PosterCard({
  reel,
  eager,
  scope,
}: {
  reel: ReelSummary
  eager?: boolean
  scope?: FeedScope
}) {
  const duration = clockDuration(reel.durationMs)
  return (
    <a
      href={reelHref(reel, scope)}
      className="group relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-gradient-to-b from-raised to-surface transition active:scale-[0.97]"
    >
      {reel.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.posterUrl}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
        />
      )}
      <span className="absolute inset-x-2 top-2 flex items-start justify-between gap-1">
        {reel.source ? (
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium text-white">
            <SourceDot source={reel.source} />
            {sourceMeta(reel.source).label}
          </span>
        ) : (
          <span />
        )}
        {duration && (
          <span className="glass rounded-full px-1.5 py-0.5 text-[10.5px] font-medium text-white tabular-nums">
            {duration}
          </span>
        )}
      </span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-2.5 pt-12 text-[13px] font-medium leading-snug text-white">
        <span className="line-clamp-2 [overflow-wrap:anywhere]">{reel.title}</span>
        {reel.views !== undefined && (
          <span className="mt-1 flex items-center gap-1 text-[11px] font-normal text-white/70 tabular-nums">
            <EyeIcon className="h-3.5 w-3.5" />
            {formatCount(reel.views)}
          </span>
        )}
      </span>
    </a>
  )
}

export function ReelGrid({ reels, scope }: { reels: ReelSummary[]; scope?: FeedScope }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {reels.map((r, i) => (
        <li
          key={r.id}
          className="animate-fade-up"
          style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
        >
          <PosterCard reel={r} eager={i < 6} scope={scope} />
        </li>
      ))}
    </ul>
  )
}

/** Sticky row of source filters; plain links so it works without JS and crawlers can follow it. */
export function SourceFilter({ chips, sticky = true }: { chips: SourceChip[]; sticky?: boolean }) {
  return (
    <nav
      aria-label="Filter by source"
      className={
        sticky
          ? 'sticky top-0 z-20 -mx-5 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md'
          : ''
      }
    >
      <ul className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        {chips.map((chip) => (
          <li key={chip.source ?? 'all'} className="shrink-0">
            <a
              href={chip.href}
              aria-current={chip.active ? 'page' : undefined}
              className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm transition active:scale-95 ${
                chip.active
                  ? 'bg-fg font-medium text-bg'
                  : 'border border-line bg-raised text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {chip.source && <SourceDot source={chip.source} />}
              {chip.source ? sourceMeta(chip.source).label : 'All'}
              <span className="text-xs tabular-nums opacity-60">{chip.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function TopicShelf({ shelf, source }: { shelf: Shelf; source: string | null }) {
  const href = filterHref(`/t/${shelf.topic.slug}`, source)
  return (
    <section aria-labelledby={`shelf-${shelf.topic.slug}`} className="animate-fade-up">
      <div className="flex items-end justify-between gap-4">
        <h2
          id={`shelf-${shelf.topic.slug}`}
          className="flex items-baseline gap-2 text-[17px] font-semibold tracking-tight"
        >
          <a href={href} className="transition hover:text-accent">
            {shelf.topic.label}
          </a>
          <span className="text-xs font-normal text-faint tabular-nums">
            {shelf.topic.count} reels
          </span>
        </h2>
        <a
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted transition hover:text-fg"
        >
          See all
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </a>
      </div>
      <ul className="no-scrollbar mt-3 grid grid-cols-2 gap-2 sm:-mx-5 sm:flex sm:snap-x sm:snap-mandatory sm:scroll-px-5 sm:overflow-x-auto sm:px-5">
        {shelf.reels.map((r, i) => (
          <li
            key={r.id}
            className={`sm:w-40 sm:shrink-0 sm:snap-start ${i >= MOBILE_SHELF_REELS ? 'hidden sm:block' : ''}`}
          >
            <PosterCard reel={r} eager={i < 3} scope={{ topic: shelf.topic.slug, source }} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TopicPills({
  topics,
  source,
  showCounts = true,
}: {
  topics: TopicCount[]
  source: string | null
  showCounts?: boolean
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {topics.map((t) => (
        <li key={t.slug}>
          <a
            href={filterHref(`/t/${t.slug}`, source)}
            className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg active:scale-95"
          >
            {t.label}
            {showCounts && <span className="text-xs text-faint tabular-nums">{t.count}</span>}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function EmptyFilter({ label, resetHref }: { label: string; resetHref: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <p className="text-sm font-medium">No {label} reels here yet</p>
      <p className="mt-1 text-sm text-muted">New stories land every hour.</p>
      <a
        href={resetHref}
        className="mt-4 inline-flex rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg transition active:scale-95"
      >
        Show all sources
      </a>
    </div>
  )
}
