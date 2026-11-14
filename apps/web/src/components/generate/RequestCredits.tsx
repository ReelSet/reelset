'use client'

import { useState } from 'react'
import { CheckIcon } from '@/components/ui/icons'
import { ApiFailure, requestCredits } from './api'

type Props = {
  signedIn?: boolean
  next?: string
  label?: string
  variant?: 'solid' | 'outline'
  className?: string
  defaultOpen?: boolean
}

/** "Request more credits": signed out goes to login, signed in asks for an optional note. */
export function RequestCredits({
  signedIn = true,
  next = '/pricing',
  label = 'Request more credits',
  variant = 'outline',
  className = '',
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  const btn =
    variant === 'solid'
      ? 'bg-accent text-accent-fg hover:brightness-95'
      : 'border border-line-strong text-fg hover:bg-raised'
  const base = `inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition active:scale-95 ${btn} ${className}`

  if (!signedIn) {
    return (
      <a href={`/login?next=${encodeURIComponent(next)}`} className={base}>
        Sign in to request
      </a>
    )
  }
  if (state === 'sent') {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/10 px-3 py-2.5 text-sm text-ok"
      >
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
        Request sent. We will email you when credits are added.
      </p>
    )
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={base}>
        {label}
      </button>
    )
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setState('sending')
        setError(null)
        try {
          await requestCredits(message.trim() || undefined)
          setState('sent')
        } catch (err) {
          setState('idle')
          if (err instanceof ApiFailure && err.code === 'already_requested') {
            setState('sent')
            return
          }
          setError(err instanceof Error ? err.message : 'Could not send. Try again.')
        }
      }}
    >
      <label htmlFor="credit-note" className="text-xs text-muted">
        What are you making? (optional)
      </label>
      <textarea
        id="credit-note"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="e.g. A reel for every release of my open source project"
        className="w-full resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm placeholder:text-faint"
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={state === 'sending'}
          className={`${base} flex-1 disabled:opacity-60`}
        >
          {state === 'sending' ? 'Sending...' : 'Send request'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-full px-4 text-sm text-muted transition hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
