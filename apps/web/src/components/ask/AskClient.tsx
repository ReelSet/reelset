'use client'

import { useRef, useState } from 'react'
import type { AskResponse, AskStreamEvent } from '@/lib/api-types'
import { createSseParser } from '@/lib/ask/sse'
import { track } from '@/lib/client/track'
import { ArrowRightIcon, ClockIcon, HomeIcon, SparkleIcon } from '@/components/ui/icons'
import { RelatedReels, SourceCards } from './AnswerSources'
import { Wordmark } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { WarnIcon } from '@/components/ui/icons'
import { useToast } from '@/components/ui/Toast'

const RATE_LIMITED = 'You have asked a lot this hour. Please try again a bit later.'

const SUGGESTIONS = [
  'What is new in AI coding agents this week?',
  'Which databases are developers talking about?',
  'Any big security incidents lately?',
  'What are people building with Rust?',
]

function Notice({
  tone,
  title,
  message,
  onRetry,
}: {
  tone: 'danger' | 'warn' | 'info'
  title: string
  message: string
  onRetry?: () => void
}) {
  const palette = {
    danger: 'border-danger/30 bg-danger/10 text-danger',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    info: 'border-line bg-surface text-muted',
  }[tone]
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={`animate-fade-up flex items-start gap-3 rounded-md border p-4 text-sm ${palette}`}
    >
      <WarnIcon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-fg/75">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-full border border-current/40 px-3 py-1 text-xs transition hover:bg-white/5 active:scale-95"
        >
          Retry
        </button>
      )}
    </div>
  )
}

type State =
  | { phase: 'idle' }
  | { phase: 'loading'; partial: string }
  | { phase: 'done'; result: AskResponse }
  | { phase: 'failed'; message: string; title?: string; partial?: string }

export function AskClient({ signedIn = false }: { signedIn?: boolean }) {
  const conversationId = useRef<string | null>(null)
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<State>({ phase: 'idle' })
  const inFlight = useRef(false)
  const [asked, setAsked] = useState('')
  const partialRef = useRef('')
  const toast = useToast()

  async function submit(event?: React.FormEvent, override?: string) {
    event?.preventDefault()
    const trimmed = (override ?? question).trim()
    if (inFlight.current || trimmed.length < 3) return
    if (!navigator.onLine) {
      toast.show('You are offline. Reconnect to ask a question.', 'error')
      return
    }
    inFlight.current = true
    conversationId.current ??= crypto.randomUUID()
    partialRef.current = ''
    setAsked(trimmed)
    setQuestion('')
    setState({ phase: 'loading', partial: '' })
    track({ name: 'ask_submit' })
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed, conversationId: conversationId.current }),
      })
      if (res.status === 401) {
        const body = (await res.json()) as { loginUrl: string }
        window.location.assign(body.loginUrl)
        return
      }
      if (res.status === 400) {
        setState({
          phase: 'failed',
          title: 'That question did not work',
          message: 'Questions need 3 to 300 characters.',
        })
        return
      }
      if (res.status === 429) {
        setState({ phase: 'done', result: { outcome: 'rate_limited', message: RATE_LIMITED } })
        return
      }
      if (res.status >= 500) {
        setState({
          phase: 'failed',
          title: 'The server had a problem',
          message: 'Something broke on our side. Please try again in a moment.',
        })
        return
      }
      if (!res.ok || !res.body) throw new Error('unexpected response')
      const received: { result: AskResponse | null } = { result: null }
      const sse = createSseParser((data) => {
        const event = JSON.parse(data) as AskStreamEvent
        if (event.type === 'delta') {
          partialRef.current += event.text
          setState((prev) =>
            prev.phase === 'loading'
              ? { phase: 'loading', partial: prev.partial + event.text }
              : prev,
          )
        } else {
          received.result = event.result
        }
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        sse.push(decoder.decode(value, { stream: true }))
      }
      sse.end()
      const final = received.result
      if (!final) throw new Error('stream ended without a result')
      setState({ phase: 'done', result: final })
      if (final.outcome === 'answered') track({ name: 'ask_answer_view' })
    } catch {
      const offline = !navigator.onLine
      setState({
        phase: 'failed',
        title: offline ? 'You are offline' : 'Connection interrupted',
        message: offline
          ? 'Reconnect to the internet, then try again.'
          : 'Could not reach the server. Check your connection and try again.',
        partial: partialRef.current || undefined,
      })
    } finally {
      inFlight.current = false
    }
  }

  const loading = state.phase === 'loading'
  const idle = state.phase === 'idle'

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5">
      <header className="flex items-center justify-between pt-safe">
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-[15px]" />
        </a>
        <div className="flex items-center gap-2">
          {signedIn && (
            <a
              href="/ask/history"
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
            >
              <ClockIcon className="h-4 w-4" />
              Your questions
            </a>
          )}
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
          >
            <HomeIcon className="h-4 w-4" />
            Feed
          </a>
        </div>
      </header>

      <main className={`flex flex-1 flex-col ${idle ? 'justify-center pb-24' : 'gap-6 pt-8'}`}>
        {idle && (
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-muted">
              <SparkleIcon className="h-3.5 w-3.5 text-accent" />
              Answers cited from the feed
            </span>
            <h1 className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-tight [text-wrap:balance] sm:text-[44px]">
              Ask what developers are building.
            </h1>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
              Search across GitHub, Hacker News, Reddit, YouTube and news. Every answer links back
              to its sources.
            </p>
          </div>
        )}

        {!idle && (
          <h1 className="animate-fade-up text-2xl font-semibold leading-snug tracking-tight [text-wrap:balance]">
            {asked}
          </h1>
        )}

        {state.phase === 'loading' && (
          <section aria-live="polite" className="animate-fade-in">
            <div className="mb-3 flex items-center gap-2 text-xs text-faint">
              <span className="h-2 w-2 animate-pulse-ring rounded-full bg-accent" />
              Searching the feed
            </div>
            {state.partial ? (
              <p className="whitespace-pre-wrap text-[16px] leading-[1.7] text-fg/90">
                {state.partial}
                <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-[cursor-blink_1s_steps(1)_infinite] bg-accent" />
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="animate-shimmer h-4 w-full rounded bg-raised" />
                <div className="animate-shimmer h-4 w-11/12 rounded bg-raised" />
                <div className="animate-shimmer h-4 w-2/3 rounded bg-raised" />
              </div>
            )}
          </section>
        )}

        {state.phase === 'failed' && (
          <>
            {state.partial && (
              <p className="whitespace-pre-wrap text-[16px] leading-[1.7] text-fg/60">
                {state.partial}
              </p>
            )}
            <Notice
              tone="danger"
              title={
                state.partial ? 'The answer was cut off' : (state.title ?? 'Something went wrong')
              }
              message={state.message}
              onRetry={() => void submit(undefined, asked)}
            />
          </>
        )}

        {state.phase === 'done' && state.result.outcome === 'answered' && (
          <section className="animate-fade-up flex flex-col gap-6">
            <p className="whitespace-pre-wrap text-[16px] leading-[1.7] text-fg/90">
              {state.result.answer}
            </p>
            <RelatedReels reels={state.result.reels ?? []} />
            <SourceCards citations={state.result.citations} />
          </section>
        )}

        {state.phase === 'done' && state.result.outcome === 'error' && (
          <Notice
            tone="danger"
            title={
              state.result.reason === 'ai_unavailable'
                ? 'AI is temporarily unavailable'
                : 'Something went wrong'
            }
            message={state.result.message}
            onRetry={() => void submit(undefined, asked)}
          />
        )}

        {state.phase === 'done' && state.result.outcome === 'rate_limited' && (
          <Notice tone="warn" title="Slow down a little" message={state.result.message} />
        )}

        {state.phase === 'done' && state.result.outcome === 'spend_capped' && (
          <Notice tone="info" title="Ask is paused for today" message={state.result.message} />
        )}

        {state.phase === 'done' && state.result.outcome === 'no_evidence' && (
          <Notice tone="info" title="No answer yet" message={state.result.message} />
        )}

        <form
          onSubmit={submit}
          className={`${idle ? 'mt-8' : 'sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] mt-auto bg-gradient-to-t from-bg from-70% to-transparent pt-6 pb-2 lg:bottom-0 lg:pb-safe'}`}
        >
          <div className="flex items-end gap-2 rounded-[22px] border border-line bg-surface p-2 pl-4 transition focus-within:border-line-strong focus-within:shadow-[0_0_0_4px_rgb(200_247_81/0.08)]">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
              }}
              maxLength={300}
              rows={1}
              aria-label="Your question"
              placeholder={idle ? 'Ask about a tool, a trend, a repo...' : 'Ask a follow-up...'}
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none [field-sizing:content] placeholder:text-faint"
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={loading || question.trim().length < 3}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition active:scale-90 disabled:bg-raised disabled:text-faint"
            >
              {loading ? <Spinner /> : <ArrowRightIcon className="h-[18px] w-[18px]" />}
            </button>
          </div>
          {question.length > 240 && (
            <p className="mt-1.5 text-right text-xs text-faint">{question.length}/300</p>
          )}
        </form>

        {idle && (
          <ul className="mt-3 flex flex-wrap gap-2 pb-6">
            {SUGGESTIONS.map((s, i) => (
              <li
                key={s}
                className="animate-fade-up"
                style={{ animationDelay: `${80 + 60 * i}ms` }}
              >
                <button
                  type="button"
                  onClick={() => void submit(undefined, s)}
                  className="rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[13px] text-muted transition hover:border-line-strong hover:bg-raised hover:text-fg active:scale-95"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
