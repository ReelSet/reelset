import type { Metadata } from 'next'
import { Faq, Hero, Accent, SectionTitle, SiteFooter } from '@/components/marketing/blocks'
import { PricingCards } from '@/components/marketing/PricingCards'
import { getOptionalUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

const DESCRIPTION =
  'Reelset is free: 1,000 credits every month, about 10 reels, MCP access and MP4 downloads. Need more? Request credits.'

export const metadata: Metadata = {
  title: 'Pricing',
  description: DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: { title: 'Pricing | Reelset', description: DESCRIPTION, url: '/pricing' },
}

const FAQ = [
  {
    q: 'What is a credit?',
    a: 'Credits pay for reels you make from your own links. One reel costs 100 credits, so the free 1,000 covers about 10 reels a month. Watching the feed is always free.',
  },
  {
    q: 'When do credits reset?',
    a: 'On the 1st of every month at 00:00 UTC you get a fresh 1,000. Unused credits do not roll over.',
  },
  {
    q: 'Can I get more credits?',
    a: 'Yes, ask for more and we may grant extra credits. Extra credits granted on request are valid until the end of that month, then the monthly reset applies.',
  },
  {
    q: 'Do failed reels cost credits?',
    a: 'No. If a reel fails, or the links do not have enough text to write from, the credits are refunded automatically. If the reel already exists, it is returned instantly for free.',
  },
  {
    q: 'Is my reel public?',
    a: 'Your reels are private by default: they are not in the feed, search or sitemap, and only people with the link can watch. We may feature great ones in the public feed after review.',
  },
  {
    q: 'Can I use it from my AI agent?',
    a: 'Yes. Create an API key in your profile and connect Claude Code, Cursor, Claude Desktop or Windsurf over MCP.',
  },
]

export default async function PricingPage() {
  const user = await getOptionalUser().catch(() => null)
  return (
    <main className="pb-10">
      <Hero
        eyebrow="Simple pricing"
        title={
          <>
            Free to start. <Accent>10 reels</Accent> a month.
          </>
        }
        sub="No card, no trial clock. Credits refill every month. Ask when you need more."
      />
      <PricingCards signedIn={Boolean(user)} />
      <section className="mx-auto w-full max-w-2xl px-5 py-14">
        <SectionTitle kicker="FAQ" title="Good questions" />
        <Faq items={FAQ} />
      </section>
      <SiteFooter />
    </main>
  )
}
