import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'
import { safeReturnPath } from '@/lib/auth/return-url'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  return <LoginForm next={safeReturnPath(params.next)} failed={params.error === 'callback'} />
}
