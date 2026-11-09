'use client'

import { useState } from 'react'
import { TrashIcon } from '@/components/ui/icons'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'

export function DeleteConversation({
  id,
  onDeleted,
  label = 'Delete',
}: {
  id: string
  onDeleted: () => void
  label?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch('/api/ask/history', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.status === 401) {
        const body = (await res.json()) as { loginUrl: string }
        window.location.assign(body.loginUrl)
        return
      }
      if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      toast.show('Question deleted', 'ok')
      onDeleted()
    } catch {
      toast.show('Could not delete. Try again.', 'error')
      setBusy(false)
    }
  }

  if (confirming) {
    return (
      <span className="animate-fade-in inline-flex items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-full border border-line px-3 py-1.5 text-muted transition hover:bg-raised active:scale-95"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 font-medium text-black transition active:scale-95 disabled:opacity-60"
        >
          {busy && <Spinner />}
          Delete
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-faint transition hover:bg-raised hover:text-danger active:scale-95"
    >
      <TrashIcon className="h-4 w-4" />
      {label === 'Delete' ? null : label}
    </button>
  )
}
