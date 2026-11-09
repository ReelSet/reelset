import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ProfileLibrary } from '@/components/profile/ProfileLibrary'
import { ProfileSources } from '@/components/profile/ProfileSources'
import { ProfileTopics } from '@/components/profile/ProfileTopics'
import { ClockIcon, HomeIcon } from '@/components/ui/icons'
import { Wordmark } from '@/components/ui/Logo'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { profileSummary } from '@/server/profile'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Profile', robots: { index: false } }

function Section({
  title,
  hint,
  delay,
  children,
}: {
  title: string
  hint?: string
  delay: number
  children: React.ReactNode
}) {
  return (
    <section className="animate-fade-up mt-10" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-xs font-medium uppercase tracking-wider text-faint">{title}</h2>
      {hint && <p className="mt-1 mb-3 text-sm text-muted">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  )
}

export default async function ProfilePage() {
  const user = await getOptionalUser()
  if (!user) redirect(buildLoginUrl('/profile'))
  const profile = await profileSummary(getDb(), user.id, mediaBaseUrl())
  const initial = (user.email ?? '?').trim().charAt(0).toUpperCase() || '?'
  const since = profile.memberSince
    ? new Date(profile.memberSince).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-20">
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

      <section className="animate-fade-up mt-10 flex items-center gap-4">
        <div
          aria-hidden
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-2xl font-semibold text-accent"
        >
          {initial}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-tight">
            {user.email ?? 'Signed in'}
          </h1>
          {since && <p className="mt-0.5 text-sm text-muted">Member since {since}</p>}
        </div>
      </section>

      <Section title="Topics" hint="Reels on these topics rank higher in your feed." delay={60}>
        <ProfileTopics initial={profile.topics} />
      </Section>

      <Section title="Sources" hint="Choose where your feed pulls from." delay={120}>
        <ProfileSources initial={profile.sources} />
      </Section>

      <Section title="Your reels" delay={180}>
        <ProfileLibrary liked={profile.liked} saved={profile.saved} />
      </Section>

      <Section title="Ask" delay={240}>
        <a
          href="/ask/history"
          className="flex min-h-12 items-center gap-3 rounded-md border border-line bg-surface px-4 text-sm transition hover:bg-raised active:scale-[0.99]"
        >
          <ClockIcon className="h-[18px] w-[18px] text-muted" />
          Your questions
          <span aria-hidden className="ml-auto text-faint">
            →
          </span>
        </a>
      </Section>

      <form action="/auth/logout" method="post" className="mt-12">
        <button
          type="submit"
          className="w-full rounded-md border border-line py-3 text-sm text-muted transition hover:bg-raised hover:text-fg active:scale-[0.99]"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
