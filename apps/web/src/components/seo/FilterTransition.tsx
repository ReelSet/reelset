'use client'

import { useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
  type ReactNode,
} from 'react'

type FilterState = {
  activeSource: string | null
  pending: boolean
  select: (href: string, source: string | null) => void
}

const FilterContext = createContext<FilterState | null>(null)

function useFilterState(): FilterState {
  const state = useContext(FilterContext)
  if (!state) throw new Error('FilterTransitionProvider is missing')
  return state
}

/** Shares one navigation transition between the source chips and the list they filter. */
export function FilterTransitionProvider({
  source,
  children,
}: {
  source: string | null
  children: ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [activeSource, setActiveSource] = useOptimistic(source)

  const select = useCallback(
    (href: string, next: string | null) => {
      startTransition(() => {
        setActiveSource(next)
        router.push(href, { scroll: false })
      })
    },
    [router, setActiveSource],
  )

  const value = useMemo(() => ({ activeSource, pending, select }), [activeSource, pending, select])
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useSourceFilter() {
  const { activeSource, pending, select } = useFilterState()
  return { activeSource, pending, select }
}

/** Keeps the previous list on screen, dimmed, until the filtered one has streamed in. */
export function FilterPendingRegion({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const { pending } = useFilterState()
  return (
    <div
      aria-busy={pending}
      className={`transition-opacity duration-200 ${pending ? 'opacity-50' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
