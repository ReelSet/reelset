import { BoltIcon } from '@/components/ui/icons'
import type { CreditsDto } from '@/lib/generate/types'

export function CreditsPill({ credits, low }: { credits: CreditsDto; low?: boolean }) {
  const fmt = (n: number) => n.toLocaleString('en-US')
  const text = credits.unlimited
    ? 'Unlimited credits'
    : `${fmt(credits.balance)} of ${fmt(credits.monthlyFree)} free credits left · ${credits.reelsLeft} ${
        credits.reelsLeft === 1 ? 'reel' : 'reels'
      }`
  return (
    <a
      href="/pricing"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition hover:bg-raised ${
        low ? 'border-warn/40 text-warn' : 'border-line text-muted'
      }`}
    >
      <BoltIcon className="h-3.5 w-3.5 text-accent" />
      {text}
    </a>
  )
}
