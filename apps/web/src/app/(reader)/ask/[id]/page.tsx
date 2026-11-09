import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { RelatedReels, SourceCards } from '@/components/ask/AnswerSources'
import { ConversationDelete } from '@/components/ask/ConversationDelete'
import { Wordmark } from '@/components/ui/Logo'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { getConversation } from '@/server/ask-history'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Question', robots: { index: false } }

export default async function AskEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const user = await getOptionalUser()
  if (!user) redirect(buildLoginUrl(`/ask/${id}`))
  const conversation = await getConversation(
    getDb(),
    user.id,
    id,
    mediaBaseUrl(),
    routeLog('ask/entry'),
  )
  if (!conversation) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <header className="flex items-center justify-between pt-safe">
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-[15px]" />
        </a>
        <div className="flex items-center gap-2">
          <ConversationDelete id={id} />
          <a
            href="/ask/history"
            className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
          >
            Your questions
          </a>
        </div>
      </header>
      <div className="mt-10 flex flex-col gap-12">
        {conversation.turns.map((turn) => (
          <article key={turn.id} className="animate-fade-up flex flex-col gap-6">
            <h1 className="text-2xl font-semibold leading-snug tracking-tight [text-wrap:balance]">
              {turn.question}
            </h1>
            <p className="whitespace-pre-wrap text-[16px] leading-[1.7] text-fg/90">
              {turn.answer}
            </p>
            <RelatedReels reels={turn.reels} />
            <SourceCards citations={turn.citations} />
          </article>
        ))}
      </div>
      <a
        href="/ask"
        className="mt-12 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
      >
        Ask another
      </a>
    </div>
  )
}
