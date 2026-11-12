import { HomeIcon } from '@/components/ui/icons'
import { Wordmark } from '@/components/ui/Logo'
import { jsonLdHtml } from '@/lib/seo/json-ld'
import { reelPath } from '@/lib/reel-url'
import type { ReelSummary } from '@/lib/seo/types'

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }} />
  )
}

/** Header and width shared by the public reading pages (topics, archived reels). */
export function PageChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-20">
      <header className="flex items-center justify-between pt-safe">
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-[15px]" />
        </a>
        <nav className="flex items-center gap-2 text-xs">
          <a
            href="/t"
            className="rounded-full px-3 py-1.5 text-muted transition hover:bg-raised hover:text-fg"
          >
            Topics
          </a>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-muted transition hover:bg-raised hover:text-fg active:scale-95"
          >
            <HomeIcon className="h-4 w-4" />
            Feed
          </a>
        </nav>
      </header>
      {children}
    </div>
  )
}

export function ReelGrid({ reels }: { reels: ReelSummary[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {reels.map((r, i) => (
        <li
          key={r.id}
          className="animate-fade-up"
          style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
        >
          <a
            href={reelPath(r)}
            className="group relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-surface transition active:scale-[0.97]"
          >
            {r.posterUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.posterUrl}
                alt=""
                loading={i < 6 ? 'eager' : 'lazy'}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            )}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 pt-10 text-[13px] font-medium leading-snug text-white">
              <span className="line-clamp-3 [overflow-wrap:anywhere]">{r.title}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
