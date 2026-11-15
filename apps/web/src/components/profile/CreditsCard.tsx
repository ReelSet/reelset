'use client'

import { useEffect, useState } from 'react'
import { getCredits } from '@/components/generate/api'
import { resetsLabel } from '@/components/generate/format'
import { RequestCredits } from '@/components/generate/RequestCredits'
import { BoltIcon } from '@/components/ui/icons'
import { useTimeZone } from '@/components/ui/TimeZoneContext'
import { Skeleton } from '@/components/ui/Skeleton'
import type { CreditsDto } from '@/lib/generate/types'

export function CreditsCard() {
  const [c, setC] = useState<CreditsDto | null>(null)
  const [failed, setFailed] = useState(false)
  const tz = useTimeZone()
  useEffect(() => {
    getCredits()
      .then(setC)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="text-sm text-muted">Could not load your credits.</p>
  if (!c) return <Skeleton className="h-36 w-full" />

  const pct = c.unlimited ? 100 : Math.min(100, Math.max(0, (c.balance / c.monthlyFree) * 100))
  const fmt = (n: number) => n.toLocaleString('en-US')
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <BoltIcon className="h-3.5 w-3.5 text-accent" />
            Credits
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
            {c.unlimited ? 'Unlimited' : fmt(c.balance)}
            {!c.unlimited && (
              <span className="text-base font-normal text-faint"> / {fmt(c.monthlyFree)}</span>
            )}
          </p>
        </div>
        {!c.unlimited && (
          <p className="pb-1 text-right text-sm text-muted">
            <span className="font-medium text-fg">{c.reelsLeft}</span>{' '}
            {c.reelsLeft === 1 ? 'reel' : 'reels'} left
          </p>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Credits left this month"
        aria-valuemin={0}
        aria-valuemax={c.monthlyFree}
        aria-valuenow={c.unlimited ? c.monthlyFree : c.balance}
        className="mt-3 h-2 overflow-hidden rounded-full bg-raised"
      >
        <div
          className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-slow ease-out"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
      <p className="mt-2 text-xs text-faint">
        {c.unlimited
          ? 'Admin account, no limits.'
          : `A reel costs ${c.cost} credits. Resets ${resetsLabel(c.resetsAt, tz)} your time, unused credits do not roll over.`}
      </p>
      {!c.unlimited && (
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <RequestCredits label="Request more" />
          <a
            href="/create"
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-muted hover:text-fg"
          >
            Make a reel →
          </a>
        </div>
      )}
    </div>
  )
}
