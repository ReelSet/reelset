'use client'

import { RequestCredits } from '@/components/generate/RequestCredits'
import { BoltIcon, CheckIcon } from '@/components/ui/icons'
import { useAuthHint } from '@/components/ui/useAuthHint'
import { CtaLink } from './blocks'

const INCLUDED = [
  '1,000 credits every month',
  'About 10 reels (100 credits each)',
  'MCP and API key access',
  'Download every reel as MP4',
  'Failed reels are refunded',
]

export function PricingCards() {
  const signedIn = useAuthHint()
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 px-5 md:grid-cols-[1.2fr_1fr]">
      <section className="relative overflow-hidden rounded-lg border border-accent/40 bg-surface p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/15 blur-3xl"
        />
        <p className="inline-flex rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent-fg">
          Free forever
        </p>
        <h2 className="mt-4 text-sm text-muted">Free plan</h2>
        <p className="mt-1 flex items-end gap-1.5">
          <span className="text-5xl font-semibold tracking-tight">1,000</span>
          <span className="pb-1.5 text-sm text-muted">credits / month</span>
        </p>
        <p className="mt-1 text-sm text-faint">About 10 reels. No credit card.</p>
        <ul className="mt-5 flex flex-col gap-2.5">
          {INCLUDED.map((i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              {i}
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <CtaLink href={signedIn ? '/create' : '/login?next=/create'}>
            {signedIn ? 'Make a reel' : 'Start free'}
          </CtaLink>
        </div>
      </section>

      <section className="flex flex-col rounded-lg border border-line bg-surface p-6">
        <BoltIcon className="h-6 w-6 text-accent" />
        <h2 className="mt-4 text-lg font-semibold tracking-tight">Need more?</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Making reels for a project, a channel or a team? Tell us what you are building and we will
          top you up.
        </p>
        <div className="mt-auto pt-6">
          <RequestCredits signedIn={signedIn} next="/pricing" variant="outline" />
        </div>
      </section>
    </div>
  )
}
