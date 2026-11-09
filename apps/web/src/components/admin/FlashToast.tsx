'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/ui/Toast'

export function FlashToast({ kind, message }: { kind: 'ok' | 'error'; message: string }) {
  const toast = useToast()
  useEffect(() => {
    toast.show(message, kind)
    const url = new URL(window.location.href)
    if (url.searchParams.has('flash')) {
      url.searchParams.delete('flash')
      window.history.replaceState(null, '', url.pathname + url.search)
    }
  }, [kind, message, toast])
  return null
}
