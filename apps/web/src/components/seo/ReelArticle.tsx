import type { ReelPageData } from '@/lib/seo/types'
import {
  FactsSection,
  ReelHeader,
  SourcesSection,
  TldrSection,
  TopicsNav,
  TranscriptSection,
} from './reel-sections'

/** The written side of a reel: what crawlers and AI engines read, and what readers can cite. */
export function ReelArticle({ reel }: { reel: ReelPageData }) {
  return (
    <article className="flex flex-col gap-5 text-sm leading-relaxed text-muted">
      <ReelHeader reel={reel} />
      <TldrSection reel={reel} />
      <FactsSection reel={reel} />
      <TranscriptSection reel={reel} />
      <SourcesSection reel={reel} />
      <TopicsNav reel={reel} />
    </article>
  )
}
