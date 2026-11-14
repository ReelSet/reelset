'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon } from '@/components/ui/icons'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
  iconOnly = false,
}: {
  text: string
  label?: string
  className?: string
  iconOnly?: boolean
}) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setDone(false), 1800)
        }
      }}
      aria-label={iconOnly ? label : undefined}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg active:scale-95 ${className}`}
    >
      {done ? (
        <CheckIcon className="h-3.5 w-3.5 text-accent" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      {!iconOnly && <span aria-live="polite">{done ? 'Copied' : label}</span>}
    </button>
  )
}
