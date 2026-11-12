import { ArrowUpRightIcon } from '@/components/ui/icons'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { topicPath, topicSlug } from '@/lib/reel-url'
import { hostOf, topicLabel } from '@/lib/seo/site'
import type { ReelPageData } from '@/lib/seo/types'

const heading = 'text-[11px] font-medium uppercase tracking-[0.12em] text-faint'
const link = 'underline decoration-white/20 underline-offset-2 transition hover:text-fg'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** The written side of a reel: what crawlers and AI engines read, and what readers can cite. */
export function ReelArticle({ reel }: { reel: ReelPageData }) {
  const topics = reel.topics.filter((t) => topicSlug(t))
  const lead = reel.mentions[0]?.source
  return (
    <article className="flex flex-col gap-5 text-sm leading-relaxed text-muted">
      <header>
        <p className="flex items-center gap-1.5 text-xs text-faint">
          {lead && <SourceDot source={lead} />}
          {lead ? sourceMeta(lead).label : 'Reel'}
          <span aria-hidden>·</span>
          <time dateTime={reel.publishedAt}>{formatDate(reel.publishedAt)}</time>
        </p>
        <h1 className="mt-2 text-lg font-semibold leading-snug tracking-tight text-fg [overflow-wrap:anywhere]">
          {reel.title}
        </h1>
      </header>

      {reel.tldr && (
        <section aria-labelledby="tldr">
          <h2 id="tldr" className={heading}>
            TL;DR
          </h2>
          <p className="mt-1.5 text-fg/90">{reel.tldr}</p>
        </section>
      )}

      {reel.facts.length > 0 && (
        <section aria-labelledby="facts">
          <h2 id="facts" className={heading}>
            Key facts
          </h2>
          <ul className="mt-1.5 flex flex-col gap-2">
            {reel.facts.map((fact) => (
              <li key={fact.text} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span>
                  {fact.text}
                  {fact.sources.map((s, i) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noopener"
                      title={s.title}
                      className={`ml-1 text-xs text-faint ${link}`}
                    >
                      [{i + 1}]
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reel.transcript && (
        <section aria-labelledby="transcript">
          <h2 id="transcript" className={heading}>
            Transcript
          </h2>
          <p className="mt-1.5">{reel.transcript}</p>
        </section>
      )}

      <section aria-labelledby="sources">
        <h2 id="sources" className={heading}>
          Sources
        </h2>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          <li>
            <a
              href={reel.canonicalUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 font-medium text-fg transition hover:text-accent"
            >
              Original: {hostOf(reel.canonicalUrl)}
              <ArrowUpRightIcon className="h-3.5 w-3.5" />
            </a>
          </li>
          {reel.mentions
            .filter((m) => m.url !== reel.canonicalUrl)
            .map((m) => (
              <li key={m.url} className="flex items-center gap-2">
                <SourceDot source={m.source} />
                <a href={m.url} target="_blank" rel="noopener" className={`truncate ${link}`}>
                  {sourceMeta(m.source).label}
                  {m.title ? `: ${m.title}` : ` (${hostOf(m.url)})`}
                </a>
                {m.score !== null && (
                  <span className="shrink-0 text-xs text-faint tabular-nums">{m.score} pts</span>
                )}
              </li>
            ))}
        </ul>
      </section>

      {topics.length > 0 && (
        <nav aria-label="Topics" className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <a
              key={t}
              href={topicPath(t)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
            >
              {topicLabel(t)}
            </a>
          ))}
        </nav>
      )}
    </article>
  )
}
