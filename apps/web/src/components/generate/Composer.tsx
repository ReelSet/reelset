'use client'

import { useId, useRef, useState } from 'react'
import { ArrowRightIcon, CloseIcon, SparkleIcon } from '@/components/ui/icons'
import { SourceDot } from '@/components/ui/sources'
import { MAX_URLS_PER_REQUEST } from '@/lib/generate/types'
import type { CreditsDto, ReelRequestDto } from '@/lib/generate/types'
import { ApiFailure, generate } from './api'
import { detectSource, displayUrl, normalizeUrl } from './detect'
import { CreditsPill } from './CreditsPill'
import { RequestCredits } from './RequestCredits'

type Props = {
  credits: CreditsDto | null
  onCreated: (request: ReelRequestDto, credits: CreditsDto) => void
}

export function Composer({ credits, onCreated }: Props) {
  const [urls, setUrls] = useState<string[]>([])
  const [text, setText] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<ApiFailure | null>(null)
  const [pending, setPending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  const outOfCredits = credits ? !credits.unlimited && credits.balance < credits.cost : false

  /** Moves complete URLs from the text into chips and returns the rest of the text. */
  function commit(
    raw: string,
    final: boolean,
    base: string[] = urls,
  ): { urls: string[]; rest: string } {
    const parts = raw.split(/[\s,]+/)
    const tail = final ? '' : (parts.pop() ?? '')
    const next = [...base]
    const rejected: string[] = []
    let overflow = false
    for (const part of parts) {
      if (!part) continue
      const url = normalizeUrl(part)
      if (!url) rejected.push(part)
      else if (!next.includes(url)) {
        if (next.length >= MAX_URLS_PER_REQUEST) overflow = true
        else next.push(url)
      }
    }
    setHint(
      overflow
        ? `Up to ${MAX_URLS_PER_REQUEST} links per reel.`
        : rejected.length
          ? `That does not look like a link: ${(rejected[0] ?? '').slice(0, 40)}`
          : null,
    )
    return { urls: next, rest: tail || rejected.join(' ') }
  }

  function onChange(value: string) {
    setError(null)
    if (/[\s,]/.test(value)) {
      const r = commit(value, false)
      setUrls(r.urls)
      setText(r.rest)
    } else {
      setText(value)
      setHint(null)
    }
  }

  async function submit() {
    const r = commit(text, true)
    setUrls(r.urls)
    setText(r.rest)
    if (r.urls.length === 0) {
      setHint((h) => h ?? 'Paste at least one link.')
      input.current?.focus()
      return
    }
    if (r.rest) return
    setPending(true)
    setError(null)
    try {
      const res = await generate(r.urls)
      onCreated(res.request, res.credits)
      setUrls([])
      setText('')
    } catch (err) {
      setError(err instanceof ApiFailure ? err : new ApiFailure('internal', 'Try again.', 500))
    } finally {
      setPending(false)
    }
  }

  const cost = credits?.cost ?? 100

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        className="rounded-lg border border-line-strong bg-surface p-3 shadow-[0_0_0_1px_rgb(200_247_81/0.04),0_24px_60px_-24px_rgb(200_247_81/0.18)] transition focus-within:border-accent/60 sm:p-4"
        onClick={() => input.current?.focus()}
      >
        <label htmlFor={id} className="sr-only">
          Links to turn into a reel
        </label>
        {urls.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Links added">
            {urls.map((u) => {
              const d = detectSource(u)
              return (
                <li
                  key={u}
                  className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-raised py-1 pl-2.5 pr-1 text-xs animate-fade-in"
                >
                  <SourceDot source={d.source} />
                  <span className="shrink-0 text-muted">{d.label}</span>
                  <span className="min-w-0 truncate text-fg/90">{displayUrl(u)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${displayUrl(u)}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setUrls(urls.filter((x) => x !== u))
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-faint transition hover:bg-hover hover:text-fg"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <textarea
          id={id}
          ref={input}
          value={text}
          rows={urls.length ? 2 : 3}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text')
            if (!/[\s,]/.test(pasted.trim())) return
            e.preventDefault()
            const r = commit(`${text} ${pasted}`, true)
            setUrls(r.urls)
            setText(r.rest)
            setError(null)
          }}
          onBlur={() => {
            if (text.trim()) {
              const r = commit(text, true)
              setUrls(r.urls)
              setText(r.rest)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Backspace' && !text && urls.length) {
              setUrls(urls.slice(0, -1))
            }
          }}
          placeholder={
            urls.length
              ? 'Add another link...'
              : 'Paste a GitHub repo, HN thread, YouTube video, arXiv paper or article. Add up to 5 links.'
          }
          className="block w-full resize-none bg-transparent px-1 py-1 text-[16px] leading-relaxed text-fg placeholder:text-faint focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-faint" aria-live="polite">
            {urls.length > 0
              ? `${urls.length} link${urls.length > 1 ? 's' : ''} → 1 reel · ${cost} credits`
              : 'Several links become one reel.'}
          </p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-95 active:scale-95 disabled:opacity-70"
          >
            {pending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-fg/30 border-t-accent-fg" />
                Starting...
              </>
            ) : (
              <>
                <SparkleIcon className="h-4 w-4" />
                Generate reel
                <ArrowRightIcon className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-3 flex min-h-6 flex-col items-center gap-3" aria-live="polite">
        {hint && <p className="text-xs text-warn">{hint}</p>}
        {error && error.code === 'out_of_credits' ? (
          <div
            role="alert"
            className="w-full rounded-md border border-warn/30 bg-warn/10 p-4 text-left text-sm"
          >
            <p className="font-medium text-warn">You are out of credits for this month.</p>
            <p className="mt-1 text-muted">
              Free credits come back on the 1st (UTC). Need more sooner? Tell us what you are
              making.
            </p>
            <div className="mt-3">
              <RequestCredits variant="solid" label="Request more credits" />
            </div>
          </div>
        ) : (
          error && (
            <p role="alert" className="text-sm text-danger">
              {error.message}
            </p>
          )
        )}
        {credits && <CreditsPill credits={credits} low={outOfCredits} />}
      </div>
    </div>
  )
}
