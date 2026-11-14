import { ArrowRightIcon, BoltIcon, KeyIcon, PlayIcon, SparkleIcon } from '@/components/ui/icons'
import { SourceDot } from '@/components/ui/sources'

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
    <a
      href={href}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition active:scale-95 ${
        variant === 'solid'
          ? 'bg-accent text-accent-fg hover:brightness-95'
          : 'border border-line-strong text-fg hover:bg-raised'
      }`}
    >
      {children}
      {variant === 'solid' && <ArrowRightIcon className="h-4 w-4" />}
    </a>
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

function Phone({ source, title, tilt }: { source: string; title: string; tilt: string }) {
  return (
    <div
      aria-hidden
      className={`relative aspect-[9/16] w-32 shrink-0 overflow-hidden rounded-[18px] border border-line-strong bg-gradient-to-b from-raised to-bg shadow-2xl sm:w-40 ${tilt}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(200_247_81/0.18),transparent_55%)]" />
      <div className="absolute left-2.5 top-3 flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] text-white/80">
        <SourceDot source={source} />
        {source === 'github' ? 'GitHub' : source === 'hn' ? 'Hacker News' : 'YouTube'}
      </div>
      <div className="absolute inset-x-3 top-[42%] text-center text-[11px] font-bold leading-tight text-white drop-shadow sm:text-xs">
        <span className="rounded bg-accent px-1 text-accent-fg">{title.split(' ')[0]}</span>{' '}
        {title.split(' ').slice(1).join(' ')}
      </div>
      <div className="absolute bottom-3 left-3 flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
        <PlayIcon className="h-3 w-3 text-white" />
      </div>
      <div className="absolute inset-x-0 top-0 h-0.5 bg-white/10">
        <div className="h-full w-2/5 bg-accent" />
      </div>
    </div>
  )
}

export function PhoneShowcase() {
  return (
    <div className="flex items-end justify-center gap-3 px-5 py-6 sm:gap-5">
      <Phone source="hn" title="Show HN: a database in 200 lines" tilt="-rotate-3 translate-y-3" />
      <Phone source="github" title="Zero config build tool hits 40k stars" tilt="scale-105" />
      <Phone
        source="youtube"
        title="Why this talk broke the internet"
        tilt="rotate-3 translate-y-3"
      />
    </div>
  )
}

export function McpTeaser() {
  return (
    <section className="mx-auto w-full max-w-4xl px-5 py-6">
      <a
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
      </a>
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
        <a href="/pricing" className="text-sm font-semibold text-accent hover:underline">
          See pricing →
        </a>
      </div>
    </section>
  )
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
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
        <a href="/" className="hover:text-fg">
          Feed
        </a>
        <a href="/create" className="hover:text-fg">
          Create
        </a>
        <a href="/mcp" className="hover:text-fg">
          MCP
        </a>
        <a href="/pricing" className="hover:text-fg">
          Pricing
        </a>
        <a href="/ask" className="hover:text-fg">
          Ask
        </a>
      </nav>
    </footer>
  )
}
