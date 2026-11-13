import { HomeIcon } from '@/components/ui/icons'
import { Wordmark } from '@/components/ui/Logo'
import { jsonLdHtml } from '@/lib/seo/json-ld'

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }} />
  )
}

/** Header and width shared by the public reading pages (topics, archived reels). */
export function PageChrome({
  children,
  wide = false,
}: {
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={`mx-auto w-full px-5 pb-20 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <header className="flex items-center justify-between pt-safe lg:hidden">
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
