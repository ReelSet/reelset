'use client'

import { useEffect, useState } from 'react'
import { hasAuthHint } from '@/lib/auth/cookie-options'

/** Whether the rs_auth hint cookie says a session exists; false on the server and first paint. */
export function useAuthHint(): boolean {
  const [hinted, setHinted] = useState(false)
  useEffect(() => setHinted(hasAuthHint(document.cookie)), [])
  return hinted
}
