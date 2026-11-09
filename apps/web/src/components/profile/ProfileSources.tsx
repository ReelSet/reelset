'use client'

import { useState, useTransition } from 'react'
import { updateSources } from '@/app/profile/actions'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { useToast } from '@/components/ui/Toast'
import { PROFILE_SOURCES, type ProfileSource } from '@/lib/preferences'

export function ProfileSources({ initial }: { initial: ProfileSource[] }) {
  const [enabled, setEnabled] = useState<ProfileSource[]>(initial)
  const [, start] = useTransition()
  const toast = useToast()

  function toggle(source: ProfileSource) {
    const next = enabled.includes(source)
      ? enabled.filter((s) => s !== source)
      : PROFILE_SOURCES.filter((s) => s === source || enabled.includes(s))
    if (next.length === 0) {
      toast.show('Keep at least one source on.', 'info')
      return
    }
    const previous = enabled
    setEnabled(next)
    start(async () => {
      try {
        const res = await updateSources(next)
        if (!res.ok) throw new Error(res.error)
      } catch {
        setEnabled(previous)
        toast.show('Could not save sources. Try again.', 'error')
      }
    })
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {PROFILE_SOURCES.map((source) => {
        const on = enabled.includes(source)
        return (
          <li key={source}>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => toggle(source)}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm transition hover:bg-raised active:bg-hover"
            >
              <SourceDot source={source} />
              <span className={on ? 'text-fg' : 'text-muted'}>{sourceMeta(source).label}</span>
              <span
                aria-hidden
                className={`ml-auto h-[22px] w-10 rounded-full p-0.5 transition-colors duration-200 ${on ? 'bg-accent' : 'bg-hover'}`}
              >
                <span
                  className={`block h-[18px] w-[18px] rounded-full transition-transform duration-200 ease-spring ${on ? 'translate-x-[18px] bg-accent-fg' : 'bg-muted'}`}
                />
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
