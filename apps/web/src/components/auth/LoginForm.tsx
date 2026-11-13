'use client'

import { useState } from 'react'
import { LogoMark } from '@/components/ui/Logo'
import { SocialLinks } from '@/components/ui/SocialLinks'
import { Spinner } from '@/components/ui/Spinner'
import { describeOAuthError, describeSignInError, validateEmail } from '@/lib/auth/email'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

type Status = 'idle' | 'sending' | 'sent' | 'error'

async function googleEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    })
    if (!res.ok) return true
    const body = (await res.json()) as { external?: { google?: boolean } }
    return body.external?.google !== false
  } catch {
    return true
  }
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.51 5.51 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.16 3.57-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.61H1.29a12 12 0 0 0 0 10.78l4-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.09C6.23 6.86 8.88 4.75 12 4.75z"
      />
    </svg>
  )
}

export function LoginForm({ next, failed }: { next: string; failed: boolean }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [touched, setTouched] = useState(false)
  const [message, setMessage] = useState(failed ? 'That sign-in link did not work. Try again.' : '')

  const [googleBusy, setGoogleBusy] = useState(false)

  async function continueWithGoogle() {
    if (googleBusy) return
    if (!navigator.onLine) {
      setStatus('error')
      setMessage('You are offline. Reconnect to the internet, then try again.')
      return
    }
    setGoogleBusy(true)
    setMessage('')
    try {
      if (!(await googleEnabled())) {
        setGoogleBusy(false)
        setStatus('error')
        setMessage(describeOAuthError({ message: 'provider is not enabled' }))
        return
      }
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      })
      if (error) throw error
    } catch (err) {
      setGoogleBusy(false)
      setStatus('error')
      setMessage(describeOAuthError(err instanceof Error ? err : {}))
    }
  }

  const fieldError = touched ? validateEmail(email) : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (status === 'sending' || validateEmail(email)) return
    if (!navigator.onLine) {
      setStatus('error')
      setMessage('You are offline. Reconnect to the internet, then try again.')
      return
    }
    setStatus('sending')
    setMessage('')
    try {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      })
      if (error) {
        setStatus('error')
        setMessage(describeSignInError(error))
        return
      }
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      setMessage(describeSignInError(err instanceof Error ? err : {}))
    }
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
          Like reels and tune your feed. Continue with Google, or we email you a magic link.
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
          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-3">
            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={googleBusy || status === 'sending'}
              aria-busy={googleBusy}
              className="inline-flex items-center justify-center gap-2.5 rounded-md border border-line bg-surface px-4 py-3 text-sm font-medium text-fg transition hover:border-line-strong active:scale-[0.98] disabled:opacity-60"
            >
              {googleBusy ? <Spinner /> : <GoogleMark />}
              Continue with Google
            </button>
            <div className="flex items-center gap-3 text-xs text-faint" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => email && setTouched(true)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'email-error' : undefined}
              disabled={status === 'sending'}
              className={`rounded-md border bg-surface px-4 py-3 text-base outline-none transition placeholder:text-faint focus:shadow-[0_0_0_4px_rgb(200_247_81/0.08)] disabled:opacity-60 ${
                fieldError ? 'border-danger/60' : 'border-line focus:border-line-strong'
              }`}
            />
            {fieldError && (
              <p id="email-error" role="alert" className="-mt-1 text-sm text-danger">
                {fieldError}
              </p>
            )}
            <button
              type="submit"
              disabled={status === 'sending'}
              aria-busy={status === 'sending'}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition active:scale-[0.98] disabled:opacity-60"
            >
              {status === 'sending' && <Spinner />}
              {status === 'sending' ? 'Sending' : 'Send magic link'}
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
        <SocialLinks className="mt-10" />
      </div>
    </main>
  )
}
