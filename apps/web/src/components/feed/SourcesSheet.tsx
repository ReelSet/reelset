'use client'

import { useEffect } from 'react'
import { PEXELS_HOME_URL, type CreditsDto, type FeedItemDto } from '@/lib/api-types'
import { track } from '@/lib/client/track'
import { ArrowUpRightIcon, CloseIcon } from '@/components/ui/icons'
import { SourceDot, sourceMeta } from '@/components/ui/sources'

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function SourcesSheet({ item, onClose }: { item: FeedItemDto; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="animate-fade-in absolute inset-0 z-40 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Sources"
        className="animate-sheet-up max-h-[75%] overflow-y-auto rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/15" />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Sources</h2>
            <p className="text-xs text-faint">Where this story is being discussed</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-raised text-muted transition hover:text-fg active:scale-90"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {item.mentions.map((m) => (
            <li key={m.url}>
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  track({ name: 'item_open', itemId: item.id, meta: { source: m.source } })
                }
                className="flex items-center gap-3 rounded-md border border-line bg-raised p-3 transition hover:border-line-strong hover:bg-hover active:scale-[0.99]"
              >
                <SourceDot source={m.source} className="!h-2 !w-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{sourceMeta(m.source).label}</span>
                  <span className="block truncate text-xs text-faint">{host(m.url)}</span>
                </span>
                {m.score !== null && (
                  <span className="text-xs text-muted tabular-nums">{m.score} pts</span>
                )}
                <ArrowUpRightIcon className="h-4 w-4 text-faint" />
              </a>
            </li>
          ))}
          <li>
            <a
              href={item.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                track({ name: 'item_open', itemId: item.id, meta: { source: 'original' } })
              }
              className="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-accent py-2.5 text-sm font-medium text-accent-fg transition active:scale-[0.98]"
            >
              Open original
              <ArrowUpRightIcon className="h-4 w-4" />
            </a>
          </li>
        </ul>
        {item.credits && <MediaCredits credits={item.credits} />}
      </div>
    </div>
  )
}

const creditLink = 'underline decoration-white/20 underline-offset-2 transition hover:text-fg'

function MediaCredits({ credits }: { credits: CreditsDto }) {
  return (
    <section
      aria-label="Media credits"
      className="mt-5 border-t border-line pt-4 text-xs text-faint"
    >
      {credits.stock.length > 0 && (
        <>
          <a
            href={PEXELS_HOME_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm font-medium text-muted ${creditLink}`}
          >
            Videos provided by Pexels
          </a>
          <ul className="mt-1.5 flex flex-col gap-1">
            {credits.stock.map((clip) => (
              <li key={clip.url}>
                <a href={clip.url} target="_blank" rel="noopener noreferrer" className={creditLink}>
                  {clip.creator ? `Video by ${clip.creator} on Pexels` : 'Video on Pexels'}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {credits.demo && (
        <p className={credits.stock.length > 0 ? 'mt-2' : undefined}>
          <a
            href={credits.demo.url}
            target="_blank"
            rel="noopener noreferrer"
            className={creditLink}
          >
            Demo from github.com/{credits.demo.repo}
          </a>
        </p>
      )}
    </section>
  )
}
