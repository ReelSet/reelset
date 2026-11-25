import Link from 'next/link'
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
    <Link
      href={reelHref(reel, scope)}
      className="group relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-gradient-to-b from-raised to-surface transition active:scale-[0.97]"
    >
      {(reel.thumbUrl ?? reel.posterUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={(reel.thumbUrl ?? reel.posterUrl) as string}
          alt=""
          width={360}
          height={640}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
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
    </Link>
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

export function TopicShelf({ shelf, source }: { shelf: Shelf; source: string | null }) {
  const href = filterHref(`/t/${shelf.topic.slug}`, source)
  return (
    <section aria-labelledby={`shelf-${shelf.topic.slug}`} className="animate-fade-up">
      <div className="flex items-end justify-between gap-4">
        <h2
          id={`shelf-${shelf.topic.slug}`}
          className="flex items-baseline gap-2 text-[17px] font-semibold tracking-tight"
        >
          <Link href={href} className="transition hover:text-accent">
            {shelf.topic.label}
          </Link>
          <span className="text-xs font-normal text-faint tabular-nums">
            {shelf.topic.count} reels
          </span>
        </h2>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted transition hover:text-fg"
        >
          See all
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ul className="no-scrollbar mt-3 grid grid-cols-2 gap-2 sm:-mx-5 sm:flex sm:snap-x sm:snap-mandatory sm:scroll-px-5 sm:overflow-x-auto sm:px-5">
        {shelf.reels.map((r, i) => (
          <li
            key={r.id}
            className={`sm:w-40 sm:shrink-0 sm:snap-start ${i >= MOBILE_SHELF_REELS ? 'hidden sm:block' : ''}`}
          >
            <PosterCard reel={r} scope={{ topic: shelf.topic.slug, source }} />
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
          <Link
            href={filterHref(`/t/${t.slug}`, source)}
            className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg active:scale-95"
          >
            {t.label}
            {showCounts && <span className="text-xs text-faint tabular-nums">{t.count}</span>}
          </Link>
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
      <Link
        href={resetHref}
        className="mt-4 inline-flex rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg transition active:scale-95"
      >
        Show all sources
      </Link>
    </div>
  )
}
