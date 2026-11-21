'use client'

import { useSearchParams } from 'next/navigation'
import { safeReturnPath } from '@/lib/auth/return-url'
import { LoginForm } from './LoginForm'

/** Reads ?next= and ?error= in the browser so the login page itself stays static. */
export function LoginFromQuery() {
  const params = useSearchParams()
  return (
    <LoginForm
      next={safeReturnPath(params.get('next'))}
      failed={params.get('error') === 'callback'}
    />
  )
}
