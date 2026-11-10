import Link from 'next/link'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { mediaUrl } from '@/lib/media'
import { postBadge } from '@/lib/instagram/status'

export type GridReel = {
  id: string
  title: string
  source: string
  poster_key: string | null
  post_status: string | null
}

export function ReelGrid({
  reels,
  mediaBase,
  selectedId,
  hrefFor,
}: {
  reels: GridReel[]
  mediaBase: string
  selectedId: string | null
  hrefFor: (id: string) => string
}) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {reels.map((reel) => {
        const badge = postBadge(reel.post_status)
        const poster = mediaUrl(mediaBase, reel.poster_key)
        const selected = selectedId === reel.id
        return (
          <li key={reel.id}>
            <Link
              href={hrefFor(reel.id)}
              scroll={false}
              aria-current={selected ? 'true' : undefined}
              className={`group block overflow-hidden rounded-md border bg-surface transition ${
                selected ? 'border-accent' : 'border-line hover:border-line-strong'
              }`}
            >
              <span className="relative block aspect-[9/16] bg-raised">
                {poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                ) : null}
                <span
                  className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur ${badge.className}`}
                >
                  {badge.label}
                </span>
              </span>
              <span className="block px-2 py-1.5">
                <span className="line-clamp-2 text-xs leading-snug">{reel.title}</span>
                <span className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
                  <SourceDot source={reel.source} />
                  {sourceMeta(reel.source).label}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
