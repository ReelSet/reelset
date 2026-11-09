'use client'

import { useState, useTransition } from 'react'
import { updateTopics } from '@/app/profile/actions'
import { TopicChips } from '@/components/feed/TopicPicker'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'

const MAX = 8

export function ProfileTopics({ initial }: { initial: string[] }) {
  const [saved, setSaved] = useState(initial)
  const [selected, setSelected] = useState(initial)
  const [pending, start] = useTransition()
  const toast = useToast()

  const dirty = selected.length !== saved.length || selected.some((t) => !saved.includes(t))

  function toggle(topic: string) {
    setSelected((cur) =>
      cur.includes(topic)
        ? cur.filter((t) => t !== topic)
        : cur.length < MAX
          ? [...cur, topic]
          : cur,
    )
  }

  function save() {
    start(async () => {
      try {
        const res = await updateTopics(selected)
        if (res.ok) {
          setSaved(selected)
          toast.show('Topics saved. Your feed will adapt.', 'ok')
        } else {
          toast.show(
            res.error === 'unauthorized' ? 'Sign in again to save.' : 'Could not save topics.',
            'error',
          )
        }
      } catch {
        toast.show('Could not save topics. Check your connection.', 'error')
      }
    })
  }

  return (
    <div>
      <TopicChips selected={selected} onToggle={toggle} />
      <div className="mt-3 flex items-center gap-3 text-xs text-faint">
        <span className="tabular-nums">
          {selected.length}/{MAX} selected
        </span>
        {selected.length === 0 && <span>Pick at least one to tune your feed.</span>}
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={pending || selected.length === 0}
            className="animate-fade-in ml-auto inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg transition active:scale-95 disabled:opacity-40"
          >
            {pending && <Spinner />}
            Save
          </button>
        )}
      </div>
    </div>
  )
}
