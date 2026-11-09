'use client'

import { useState } from 'react'
import { LogoMark } from '@/components/ui/Logo'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export function LoginForm({ next, failed }: { next: string; failed: boolean }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState(failed ? 'That sign-in link did not work. Try again.' : '')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setStatus('sending')
    setMessage('')
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (error) {
      setStatus('error')
      setMessage(error.message)
      return
    }
    setStatus('sent')
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="animate-fade-up relative w-full max-w-sm">
        <a href="/" aria-label="Reelset home" className="inline-block">
          <LogoMark className="h-11 w-11" />
        </a>
        <h1 className="mt-6 text-[28px] font-semibold tracking-tight">Sign in to Reelset</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Like reels and tune your feed. We email you a magic link, no password needed.
        </p>

        {status === 'sent' ? (
          <div
            role="status"
            className="animate-fade-up mt-8 rounded-md border border-accent/30 bg-accent/5 p-4 text-sm"
          >
            <p className="font-medium text-accent">Check your inbox</p>
            <p className="mt-1 text-muted">
              We sent a sign-in link to <span className="text-fg">{email}</span>. You can close this
              tab.
            </p>
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="mt-3 text-xs text-faint underline-offset-2 transition hover:text-fg hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-line bg-surface px-4 py-3 text-base outline-none transition placeholder:text-faint focus:border-line-strong focus:shadow-[0_0_0_4px_rgb(200_247_81/0.08)]"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="rounded-md bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition active:scale-[0.98] disabled:opacity-60"
            >
              {status === 'sending' ? 'Sending...' : 'Send magic link'}
            </button>
            {message && (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            )}
          </form>
        )}
        <a href="/" className="mt-8 inline-block text-sm text-faint transition hover:text-fg">
          Back to the feed
        </a>
      </div>
    </main>
  )
}
