'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

const field =
  'rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none transition focus:border-line-strong'

export function SortSelect({
  options,
  value,
}: {
  options: { label: string; href: string }[]
  value: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <label className="mb-2 flex items-center gap-2 text-xs text-faint md:hidden">
      Sort by
      <select
        value={value}
        onChange={(e) => {
          const href = e.target.value
          startTransition(() => router.push(href, { scroll: false }))
        }}
        aria-busy={pending}
        className={`${field} min-w-0 flex-1`}
      >
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
