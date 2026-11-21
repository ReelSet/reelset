import Link from 'next/link'
import { ArrowRightIcon, BoltIcon, KeyIcon, SparkleIcon } from '@/components/ui/icons'

export function Hero({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string
  title: React.ReactNode
  sub: string
  children?: React.ReactNode
}) {
  return (
    <header className="relative isolate overflow-hidden px-5 pb-10 pt-14 text-center sm:pt-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[28rem] bg-[radial-gradient(ellipse_at_center,rgb(200_247_81/0.16),transparent_65%)]"
      />
      <p className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-muted animate-fade-up">
        <SparkleIcon className="h-3.5 w-3.5 text-accent" />
        {eyebrow}
      </p>
      <h1
        className="animate-fade-up mx-auto mt-5 max-w-3xl text-[40px] font-semibold leading-[1.05] tracking-tight [text-wrap:balance] sm:text-6xl"
        style={{ animationDelay: '60ms' }}
      >
        {title}
      </h1>
      <p
        className="animate-fade-up mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted [text-wrap:balance] sm:text-lg"
        style={{ animationDelay: '120ms' }}
      >
        {sub}
      </p>
      {children && (
        <div className="animate-fade-up mt-8" style={{ animationDelay: '180ms' }}>
          {children}
        </div>
      )}
    </header>
  )
}

export function Accent({ children }: { children: React.ReactNode }) {
  return <span className="text-accent">{children}</span>
}

export function CtaLink({
  href,
  children,
  variant = 'solid',
}: {
  href: string
  children: React.ReactNode
  variant?: 'solid' | 'outline'
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition active:scale-95 ${
        variant === 'solid'
          ? 'bg-accent text-accent-fg hover:brightness-95'
          : 'border border-line-strong text-fg hover:bg-raised'
      }`}
    >
      {children}
      {variant === 'solid' && <ArrowRightIcon className="h-4 w-4" />}
    </Link>
  )
}

export function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-6 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-accent">{kicker}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight [text-wrap:balance] sm:text-3xl">
        {title}
      </h2>
    </div>
  )
}

const STEPS = [
  {
    n: '1',
    title: 'Paste your links',
    body: 'A GitHub repo, a Hacker News thread, a YouTube video, an arXiv paper, any article. Mix up to five.',
  },
  {
    n: '2',
    title: 'We write and voice it',
    body: 'Reelset reads the sources, writes a tight script, adds a voice-over and burns in captions.',
  },
  {
    n: '3',
    title: 'Download and share',
    body: 'Get a vertical MP4 in a couple of minutes, ready for Reels, Shorts, TikTok or a tweet.',
  },
]

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-4xl px-5 py-10">
      <SectionTitle kicker="How it works" title="From link to reel in three steps" />
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-lg border border-line bg-surface p-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">
              {s.n}
            </span>
            <h3 className="mt-4 text-[15px] font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function McpTeaser() {
  return (
    <section className="mx-auto w-full max-w-4xl px-5 py-6">
      <Link
        href="/mcp"
        className="group relative flex flex-col gap-4 overflow-hidden rounded-lg border border-line bg-surface p-6 transition hover:border-line-strong sm:flex-row sm:items-center sm:justify-between"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/10 blur-3xl"
        />
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-accent">
            <KeyIcon className="h-3.5 w-3.5" />
            For agents
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">Let your AI make the reels</h3>
          <p className="mt-1 max-w-md text-sm text-muted">
            Connect Claude Code, Cursor or any MCP client. Say &ldquo;make a reel from this
            repo&rdquo; and get the link back.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-accent">
          Connect your agent
          <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </span>
      </Link>
    </section>
  )
}

export function PricingTeaser() {
  return (
    <section className="mx-auto w-full max-w-4xl px-5 py-6">
      <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface p-6 text-center">
        <BoltIcon className="h-6 w-6 text-accent" />
        <h3 className="text-xl font-semibold tracking-tight">Free. 10 reels every month.</h3>
        <p className="max-w-md text-sm text-muted">
          1,000 credits refill on the 1st. No card needed. Running out? Ask for more.
        </p>
        <Link href="/pricing" className="text-sm font-semibold text-accent hover:underline">
          See pricing →
        </Link>
      </div>
    </section>
  )
}

export function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-surface">
      {items.map((f) => (
        <details key={f.q} className="group px-5 py-4">
          <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
            {f.q}
            <span
              aria-hidden
              className="text-lg leading-none text-faint transition group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
        </details>
      ))}
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-10 w-full max-w-4xl border-t border-line px-5 py-8">
      <nav
        aria-label="Footer"
        className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted"
      >
        <Link href="/" className="hover:text-fg">
          Feed
        </Link>
        <Link href="/create" className="hover:text-fg">
          Create
        </Link>
        <Link href="/mcp" className="hover:text-fg">
          MCP
        </Link>
        <Link href="/pricing" className="hover:text-fg">
          Pricing
        </Link>
        <Link href="/ask" className="hover:text-fg">
          Ask
        </Link>
      </nav>
    </footer>
  )
}
