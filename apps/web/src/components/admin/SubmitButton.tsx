'use client'

import { useFormStatus } from 'react-dom'
import { Spinner } from '@/components/ui/Spinner'

export function SubmitButton({
  className,
  pendingLabel,
  formAction,
  confirm,
  children,
}: {
  className: string
  pendingLabel?: string
  formAction?: (formData: FormData) => void | Promise<void>
  confirm?: string
  children: React.ReactNode
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      formAction={formAction}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault()
      }}
      disabled={pending}
      aria-busy={pending}
      className={`${className} gap-1.5 disabled:cursor-wait disabled:opacity-60`}
    >
      {pending && <Spinner className="h-3 w-3" />}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  )
}
