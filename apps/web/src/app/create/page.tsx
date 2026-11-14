import type { Metadata } from 'next'
import { CreateApp } from '@/components/generate/CreateApp'
import {
  Accent,
  CtaLink,
  Hero,
  HowItWorks,
  McpTeaser,
  PhoneShowcase,
  PricingTeaser,
  SiteFooter,
} from '@/components/marketing/blocks'
import { getOptionalUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

const DESCRIPTION =
  'Paste a GitHub repo, Hacker News thread, YouTube video, arXiv paper or article and get a 60-second vertical reel with voice-over and captions. 10 free reels every month.'

export const metadata: Metadata = {
  title: 'Turn any link into a reel',
  description: DESCRIPTION,
  alternates: { canonical: '/create' },
  openGraph: {
    title: 'Turn any link into a reel | Reelset',
    description: DESCRIPTION,
    url: '/create',
  },
}

export default async function CreatePage() {
  const user = await getOptionalUser().catch(() => null)

  return (
    <main className="pb-10">
      <Hero
        eyebrow="1,000 free credits every month · 10 reels"
        title={
          <>
            Turn any link into a <Accent>reel</Accent>
          </>
        }
        sub="Paste a repo, a thread, a video or a paper. Get a vertical reel with voice-over and captions in a couple of minutes."
      >
        {user ? (
          <CreateApp />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <CtaLink href="/login?next=/create">Sign in to start, free</CtaLink>
            <p className="text-xs text-faint">No card needed. 10 reels every month.</p>
          </div>
        )}
      </Hero>
      {!user && (
        <>
          <PhoneShowcase />
          <HowItWorks />
          <McpTeaser />
          <PricingTeaser />
        </>
      )}
      <SiteFooter />
    </main>
  )
}
