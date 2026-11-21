import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/LoginForm'
import { LoginFromQuery } from '@/components/auth/LoginFromQuery'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: true } }

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginForm next="/" failed={false} />}>
      <LoginFromQuery />
    </Suspense>
  )
}
