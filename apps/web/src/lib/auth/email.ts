const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return 'Enter your email address.'
  if (email.length > 254 || !EMAIL_RE.test(email))
    return 'That does not look like an email address.'
  return null
}

export function describeSignInError(error: { message?: string; status?: number; code?: string }) {
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase()
  if (error.status === 429 || text.includes('rate limit') || text.includes('rate_limit')) {
    return 'Too many sign-in emails were requested. Wait a few minutes, then try again.'
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (text.includes('invalid') && text.includes('email')) return 'That email address is not valid.'
  return 'We could not send the sign-in link. Please try again.'
}
