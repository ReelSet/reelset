'use client'

import { Fragment, useCallback, useMemo, useState } from 'react'
import type { CitationDto, RelatedReelDto } from '@/lib/api-types'
import { splitAnswer, stripCitationMarks } from '@/lib/ask/citation-marks'
import { chipLabel, hostOf, sourceKindOf } from '@/lib/ask/source-label'
import { followupsFromTitles } from '@/lib/ask/suggestions'
import { ArrowRightIcon, LayersIcon, ShareIcon } from '@/components/ui/icons'
import { SourceDot } from '@/components/ui/sources'
import { useToast } from '@/components/ui/Toast'
import { RelatedReels } from './AnswerSources'
import { CheckIcon, CopyIcon, RefreshIcon } from './ask-icons'
import { AskSourcesSheet } from './SourcesSheet'

const actionBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg active:scale-95'

function CitationChip({
  citation,
  extra,
  onOpen,
}: {
  citation: CitationDto
  extra: number
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Source: ${hostOf(citation.url)}`}
      className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-[1px] align-baseline text-[11px] font-medium leading-[1.5] text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg active:scale-95"
    >
      <SourceDot source={sourceKindOf(citation.url)} />
      {chipLabel(citation.url)}
      {extra > 0 && <span className="text-faint">+{extra}</span>}
    </button>
  )
}

export function AnswerText({
  text,
  citations,
  onOpenSource,
}: {
  text: string
  citations: readonly CitationDto[]
  onOpenSource: (index: number) => void
}) {
  const parts = useMemo(() => splitAnswer(text, citations), [text, citations])
  return (
    <p className="whitespace-pre-wrap text-[16px] leading-[1.75] text-fg/90">
      {parts.map((part, i) => {
        if (part.type === 'text') return <Fragment key={i}>{part.text}</Fragment>
        const first = part.sources[0]!
        return (
          <CitationChip
            key={i}
            citation={citations[first]!}
            extra={part.sources.length - 1}
            onOpen={() => onOpenSource(first)}
          />
        )
      })}
    </p>
  )
}

export function AnswerView({
  question,
  answer,
  citations,
  reels,
  followups,
  onFollowup,
  onRegenerate,
}: {
  question: string
  answer: string
  citations: readonly CitationDto[]
  reels: readonly RelatedReelDto[]
  followups?: readonly string[]
  onFollowup?: (question: string) => void
  onRegenerate?: () => void
}) {
  const toast = useToast()
  const [sheet, setSheet] = useState<{ focus: number | null } | null>(null)
  const [copied, setCopied] = useState(false)
  const closeSheet = useCallback(() => setSheet(null), [])

  const plain = useMemo(() => stripCitationMarks(answer), [answer])
  const suggested = useMemo(() => {
    if (followups && followups.length > 0) return followups
    return followupsFromTitles(citations.map((c) => c.title))
  }, [followups, citations])

  async function copy() {
    const sources = citations.map((c, i) => `${i + 1}. ${c.title} ${c.url}`).join('\n')
    try {
      await navigator.clipboard.writeText(sources ? `${plain}\n\nSources:\n${sources}` : plain)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.show('Could not copy. Select the text instead.', 'error')
    }
  }

  async function share() {
    const url = `${window.location.origin}/ask`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: question, text: plain, url })
      } catch {
        // dismissed
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${question}\n\n${plain}\n\n${url}`)
      toast.show('Copied to share', 'ok')
    } catch {
      toast.show('Could not share from this browser.', 'error')
    }
  }

  return (
    <section className="animate-fade-up flex flex-col gap-5">
      <AnswerText
        text={answer}
        citations={citations}
        onOpenSource={(index) => setSheet({ focus: index })}
      />

      <div className="flex flex-wrap items-center gap-2">
        {citations.length > 0 && (
          <button type="button" onClick={() => setSheet({ focus: null })} className={actionBtn}>
            <LayersIcon className="h-4 w-4" />
            {citations.length} {citations.length === 1 ? 'source' : 'sources'}
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy answer"
          className={actionBtn}
        >
          {copied ? (
            <CheckIcon className="h-4 w-4 text-accent" />
          ) : (
            <CopyIcon className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button
          type="button"
          onClick={() => void share()}
          aria-label="Share answer"
          className={actionBtn}
        >
          <ShareIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </button>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            aria-label="Regenerate answer"
            className={actionBtn}
          >
            <RefreshIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Regenerate</span>
          </button>
        )}
      </div>

      <RelatedReels reels={[...reels]} />

      {onFollowup && suggested.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
            Follow up
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
            {suggested.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => onFollowup(q)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-sm text-fg/90 transition hover:bg-raised active:bg-hover"
                >
                  <span>{q}</span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sheet && (
        <AskSourcesSheet
          citations={citations}
          reels={reels}
          focus={sheet.focus}
          onClose={closeSheet}
        />
      )}
    </section>
  )
}
