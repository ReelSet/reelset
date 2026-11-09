'use client'

import { useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { TOPICS } from '@/lib/topics'

export function TopicPicker({ onDone }: { onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggle(topic: string) {
    setSelected((cur) =>
      cur.includes(topic) ? cur.filter((t) => t !== topic) : cur.length < 8 ? [...cur, topic] : cur,
    )
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/profile/topics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topics: selected }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onDone()
    } catch {
      setError('Could not save. Try again or skip.')
      setSaving(false)
    }
  }

  return (
    <div className="animate-fade-in absolute inset-0 z-40 flex flex-col justify-end bg-black/70 backdrop-blur-sm">
      <div className="animate-sheet-up rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-white/15" />
        <h2 className="text-lg font-semibold tracking-tight">What do you want to see?</h2>
        <p className="mt-1 text-sm text-muted">Pick up to 8 topics to tune your feed.</p>
        <TopicChips selected={selected} onToggle={toggle} className="mt-4" />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onDone}
            disabled={saving}
            className="flex-1 rounded-md bg-raised py-3 text-sm text-muted transition hover:text-fg active:scale-[0.98]"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={save}
            disabled={selected.length === 0 || saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-accent py-3 text-sm font-medium text-accent-fg transition active:scale-[0.98] disabled:opacity-40"
          >
            {saving && <Spinner />}
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function TopicChips({
  selected,
  onToggle,
  className = '',
}: {
  selected: string[]
  onToggle: (topic: string) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {TOPICS.map((topic) => {
        const on = selected.includes(topic)
        return (
          <button
            key={topic}
            type="button"
            onClick={() => onToggle(topic)}
            aria-pressed={on}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition duration-150 active:scale-95 ${
              on
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-line bg-raised text-fg hover:border-line-strong'
            }`}
          >
            {topic}
          </button>
        )
      })}
    </div>
  )
}
