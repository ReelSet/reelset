'use client'

import { useId, useRef } from 'react'
import { SubmitButton } from '@/components/admin/SubmitButton'

// Duplicated from admin/ui.tsx, which pulls server-only modules into any client component that imports it.
const button =
  'inline-flex items-center rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs transition hover:bg-hover active:scale-95'

// A button that opens a native modal dialog; the form only submits from the dialog's confirm button.
export function ConfirmForm({
  action,
  fields,
  triggerLabel,
  title,
  children,
  confirmLabel,
  pendingLabel,
  danger = false,
  triggerClassName = button,
}: {
  action: (formData: FormData) => void | Promise<void>
  fields: Record<string, string>
  triggerLabel: string
  title: string
  children: React.ReactNode
  confirmLabel: string
  pendingLabel: string
  danger?: boolean
  triggerClassName?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => ref.current?.showModal()}>
        {triggerLabel}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface p-0 text-fg backdrop:bg-black/70 backdrop:backdrop-blur-[2px]"
      >
        <form action={action} className="flex max-h-[85dvh] flex-col">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {children}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" className={button} onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <SubmitButton
              className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition active:scale-95 ${
                danger ? 'bg-danger text-bg' : 'bg-accent text-accent-fg'
              }`}
              pendingLabel={pendingLabel}
            >
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
