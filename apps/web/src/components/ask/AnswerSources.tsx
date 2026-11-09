import type { CitationDto, RelatedReelDto } from '@/lib/api-types'
import { ArrowUpRightIcon } from '@/components/ui/icons'
import { SourceDot, sourceMeta } from '@/components/ui/sources'

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

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
            <a href={`/?reel=${r.itemId}`} className="group block active:scale-[0.97]">
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

export function SourceCards({ citations }: { citations: CitationDto[] }) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">Sources</h2>
      <ol className="grid gap-2 sm:grid-cols-2">
        {citations.map((c, i) => (
          <li key={c.chunkId} className="animate-fade-up" style={{ animationDelay: `${60 * i}ms` }}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col gap-2 rounded-md border border-line bg-surface p-3.5 transition hover:border-line-strong hover:bg-raised active:scale-[0.99]"
            >
              <span className="flex items-center justify-between text-xs text-faint">
                <span className="flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded bg-raised font-mono text-[10px] text-muted group-hover:bg-hover">
                    {i + 1}
                  </span>
                  <span className="truncate">{host(c.url)}</span>
                </span>
                <ArrowUpRightIcon className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
              </span>
              <span className="line-clamp-2 text-sm font-medium leading-snug">{c.title}</span>
              <span className="mt-auto text-xs text-faint">
                {new Date(c.publishedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
