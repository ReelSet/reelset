import type { Metadata } from 'next'
import { CopyButton } from '@/components/generate/CopyButton'
import { Accent, Hero, SectionTitle, SiteFooter } from '@/components/marketing/blocks'
import { McpConnect } from '@/components/marketing/McpConnect'
import { BoltIcon, ClockIcon, PlayIcon, SparkleIcon } from '@/components/ui/icons'
import { getOptionalUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

const DESCRIPTION =
  'Connect Claude Code, Cursor, Claude Desktop or Windsurf to Reelset over MCP and let your agent turn any link into a reel.'

export const metadata: Metadata = {
  title: 'Connect your agent (MCP)',
  description: DESCRIPTION,
  alternates: { canonical: '/mcp' },
  openGraph: { title: 'Connect your agent | Reelset MCP', description: DESCRIPTION, url: '/mcp' },
}

const TOOLS = [
  {
    name: 'generate_reel',
    Icon: SparkleIcon,
    body: 'Turn up to 5 links into one reel. Returns a request id right away.',
  },
  {
    name: 'get_reel_status',
    Icon: ClockIcon,
    body: 'Check progress by request id. When it is ready you get the video, poster and share link.',
  },
  {
    name: 'list_my_reels',
    Icon: PlayIcon,
    body: 'See your recent reels and what each one is doing.',
  },
  {
    name: 'get_credits',
    Icon: BoltIcon,
    body: 'How many credits and reels you have left this month.',
  },
]

const PROMPT = 'Make a reel from this repo and give me the link: https://github.com/vercel/next.js'

export default async function McpPage() {
  const user = await getOptionalUser().catch(() => null)
  return (
    <main className="pb-10">
      <Hero
        eyebrow="Model Context Protocol"
        title={
          <>
            Connect your <Accent>agent</Accent>
          </>
        }
        sub="Give Claude Code, Cursor or any MCP client a new skill: turning links into finished vertical reels."
      >
        <a
          href="#connect"
          className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 text-[15px] font-semibold text-accent-fg transition active:scale-95"
        >
          Set it up in 2 minutes
        </a>
      </Hero>

      <section className="mx-auto w-full max-w-4xl px-5 py-8">
        <SectionTitle kicker="What agents can do" title="Four tools, one finished reel" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {TOOLS.map(({ name, Icon, body }) => (
            <li key={name} className="rounded-lg border border-line bg-surface p-5">
              <Icon className="h-5 w-5 text-accent" />
              <code className="mt-3 block font-mono text-sm font-medium text-fg">{name}</code>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-4xl px-5 py-6" aria-label="Example prompt">
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-faint">Then just ask</p>
            <CopyButton text={PROMPT} label="Copy prompt" />
          </div>
          <p className="mt-3 text-lg leading-snug tracking-tight sm:text-xl">
            <span className="text-accent">&gt; </span>
            Make a reel from this repo and give me the link:{' '}
            <span className="text-muted">github.com/vercel/next.js</span>
          </p>
          <p className="mt-3 text-sm text-muted">
            The agent starts the reel, checks on it, and hands you a share link and an MP4.
          </p>
        </div>
      </section>

      <section id="connect" className="mx-auto w-full max-w-2xl scroll-mt-6 px-5 py-10">
        <SectionTitle kicker="Setup" title="Connect in two steps" />
        <McpConnect signedIn={Boolean(user)} />
      </section>

      <section className="mx-auto w-full max-w-2xl px-5">
        <div className="rounded-lg border border-line bg-surface p-5 text-sm leading-relaxed text-muted">
          <p className="font-medium text-fg">Credits are shared with the website.</p>
          <p className="mt-1">
            Agent reels use the same 1,000 free credits every month (100 per reel, about 10 reels).
            Failed reels are refunded. Need more?{' '}
            <a href="/pricing" className="text-accent hover:underline">
              Request credits
            </a>
            . Keep your key secret, and revoke it anytime from your{' '}
            <a href="/profile#api-keys" className="text-accent hover:underline">
              profile
            </a>
            .
          </p>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
