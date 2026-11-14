import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { RequestStatus } from '@/components/generate/RequestStatus'
import { buildLoginUrl } from '@/lib/auth/return-url'
import { getOptionalUser } from '@/server/auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your reel', robots: { index: false, follow: false } }

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getOptionalUser().catch(() => null)
  if (!user) redirect(buildLoginUrl(`/create/${id}`))
  return (
    <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-safe lg:pt-12">
      <div className="pt-6">
        <RequestStatus id={id} />
      </div>
    </main>
  )
}
