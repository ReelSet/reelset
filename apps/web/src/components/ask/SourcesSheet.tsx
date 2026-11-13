'use client'

import { useEffect, useRef } from 'react'
import type { CitationDto, RelatedReelDto } from '@/lib/api-types'
import { reelPath } from '@/lib/reel-url'
import { hostOf, sourceKindOf } from '@/lib/ask/source-label'
import { ArrowUpRightIcon, CloseIcon } from '@/components/ui/icons'
import { SourceDot } from '@/components/ui/sources'

export function reelForCitation(
  citation: CitationDto,
  reels: readonly RelatedReelDto[],
): RelatedReelDto | undefined {
  return reels.find(
    (r) =>
      (citation.itemId !== undefined && r.itemId === citation.itemId) ||
      r.chunkIds?.includes(citation.chunkId),
  )
}

export function AskSourcesSheet({
  citations,
  reels,
  focus,
  onClose,
}: {
  citations: readonly CitationDto[]
  reels: readonly RelatedReelDto[]
  focus: number | null
  onClose: () => void
}) {
  const focusRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    focusRef.current?.scrollIntoView({ block: 'center' })
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sources"
        className="animate-sheet-up mx-auto flex max-h-[80dvh] w-full max-w-xl flex-col rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-white/15" />
        <div className="flex shrink-0 items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {citations.length} {citations.length === 1 ? 'source' : 'sources'}
            </h2>
            <p className="text-xs text-faint">Tap a reel to watch it</p>
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
        <ul className="mt-4 flex flex-col gap-2 overflow-y-auto">
          {citations.map((c, i) => {
            const reel = reelForCitation(c, reels)
            const kind = reel?.source ?? sourceKindOf(c.url)
            const content = (
              <>
                <span className="relative block h-[72px] w-[44px] shrink-0 overflow-hidden rounded-md border border-line bg-raised">
                  {reel?.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={reel.posterUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center">
                      <SourceDot source={kind} className="!h-2.5 !w-2.5" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium leading-snug">{c.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                    <SourceDot source={kind} />
                    <span className="truncate">{hostOf(c.url)}</span>
                  </span>
                </span>
                {reel ? (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg">
                    Watch
                  </span>
                ) : (
                  <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-faint" />
                )}
              </>
            )
            const cls = `flex items-center gap-3 rounded-md border bg-raised p-2.5 transition hover:border-line-strong hover:bg-hover active:scale-[0.99] ${
              focus === i ? 'border-accent/60' : 'border-line'
            }`
            return (
              <li key={c.chunkId} ref={focus === i ? focusRef : undefined}>
                {reel ? (
                  <a href={reelPath({ id: reel.itemId, title: reel.title })} className={cls}>
                    {content}
                  </a>
                ) : (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className={cls}>
                    {content}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
