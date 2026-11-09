import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HeartIcon, HomeIcon } from '@/components/ui/icons'
import { Wordmark } from '@/components/ui/Logo'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { profileSummary } from '@/server/profile'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Profile', robots: { index: false } }

export default async function ProfilePage() {
  const user = await getOptionalUser()
  if (!user) redirect(buildLoginUrl('/profile'))
  const { topics, likes } = await profileSummary(getDb(), user.id, mediaBaseUrl())

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <header className="flex items-center justify-between pt-safe">
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-[15px]" />
        </a>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
        >
          <HomeIcon className="h-4 w-4" />
          Feed
        </a>
      </header>

      <section className="animate-fade-up mt-10 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight">Your profile</h1>
          <p className="mt-1 truncate text-sm text-muted">{user.email ?? 'Signed in'}</p>
        </div>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:bg-raised hover:text-fg active:scale-95"
          >
            Sign out
          </button>
        </form>
      </section>

      {topics.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">Topics</h2>
          <ul className="flex flex-wrap gap-2">
            {topics.map((t) => (
              <li
                key={t}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted"
              >
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint">
          <HeartIcon className="h-3.5 w-3.5" />
          Liked reels
          <span className="tabular-nums">{likes.length}</span>
        </h2>
        {likes.length === 0 ? (
          <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">
            Double tap a reel to save it here.
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {likes.map((l, i) => (
              <li
                key={l.id}
                className="animate-fade-up"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <a
                  href={`/?reel=${l.id}`}
                  className="group relative block aspect-[9/16] overflow-hidden rounded-md border border-line bg-surface transition active:scale-[0.97]"
                >
                  {l.posterUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.posterUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-8 text-[11px] leading-snug">
                    <span className="line-clamp-2">{l.title}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
