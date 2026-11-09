import { PaperIcon } from './icons'

export const SOURCES: Record<string, { label: string; dot: string; text?: string }> = {
  hn: { label: 'Hacker News', dot: 'bg-src-hn' },
  reddit: { label: 'Reddit', dot: 'bg-src-reddit' },
  youtube: { label: 'YouTube', dot: 'bg-src-youtube' },
  github: { label: 'GitHub', dot: 'bg-src-github' },
  news: { label: 'News', dot: 'bg-src-news' },
  papers: { label: 'Paper', dot: 'bg-src-papers', text: 'text-src-papers' },
}

export function sourceMeta(source: string) {
  return SOURCES[source] ?? { label: source, dot: 'bg-faint' }
}

export function SourceDot({ source, className = '' }: { source: string; className?: string }) {
  if (source === 'papers') {
    return <PaperIcon className={`inline-block h-3 w-3 ${sourceMeta(source).text} ${className}`} />
  }
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${sourceMeta(source).dot} ${className}`}
    />
  )
}
