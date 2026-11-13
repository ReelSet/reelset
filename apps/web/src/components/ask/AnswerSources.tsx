import type { RelatedReelDto } from '@/lib/api-types'
import { reelPath } from '@/lib/reel-url'
import { SourceDot, sourceMeta } from '@/components/ui/sources'

export function RelatedReels({ reels }: { reels: RelatedReelDto[] }) {
  if (reels.length === 0) return null
  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">
        Related reels
      </h2>
      <ul className="no-scrollbar -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
        {reels.map((r, i) => (
          <li
            key={r.itemId}
            className="animate-fade-up w-[92px] shrink-0 snap-start"
            style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
          >
            <a
              href={reelPath({ id: r.itemId, title: r.title })}
              className="group block active:scale-[0.97]"
            >
              <span className="relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-surface transition group-hover:border-line-strong">
                {r.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.posterUrl}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                <SourceDot source={r.source} />
                <span className="truncate">{sourceMeta(r.source).label}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 text-[12px] font-medium leading-snug">
                {r.title}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
