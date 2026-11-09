import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AskHistory } from '@/components/ask/AskHistory'
import { Wordmark } from '@/components/ui/Logo'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { getOptionalUser } from '@/server/auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your questions', robots: { index: false } }

export default async function AskHistoryPage() {
  const user = await getOptionalUser()
  if (!user) redirect(buildLoginUrl('/ask/history'))
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <header className="flex items-center justify-between pt-safe">
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-[15px]" />
        </a>
        <a
          href="/ask"
          className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
        >
          Ask
        </a>
      </header>
      <h1 className="animate-fade-up mt-10 mb-6 text-[28px] font-semibold tracking-tight">
        Your questions
      </h1>
      <AskHistory />
    </div>
  )
}
