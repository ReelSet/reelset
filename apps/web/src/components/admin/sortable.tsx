import Link from 'next/link'
import { pageHref } from '@/lib/admin/pagination'
import {
  DEFAULT_SORT_NAMES,
  nextDir,
  sortParams,
  type SortDir,
  type SortNames,
  type SortState,
} from '@/lib/admin/sort'
import { SortSelect } from './SortSelect'
import { th } from './ui'

export type SortColumn<K extends string> = { key: K; label: string; firstDir?: SortDir }

export type SortCtx<K extends string> = {
  path: string
  params: Record<string, string | undefined>
  sort: SortState<K>
  fallback: SortState<K>
  columns: readonly SortColumn<K>[]
  names?: SortNames
}

export function sortHref<K extends string>(ctx: SortCtx<K>, state: SortState<K>) {
  const names = ctx.names ?? DEFAULT_SORT_NAMES
  const sorted = sortParams(state, ctx.fallback, names)
  return pageHref(ctx.path, { ...ctx.params, ...sorted }, 1)
}

export function sortQuery<K extends string>(ctx: SortCtx<K>) {
  return sortParams(ctx.sort, ctx.fallback, ctx.names ?? DEFAULT_SORT_NAMES)
}

export function SortTh<K extends string>({
  ctx,
  col,
  className = '',
}: {
  ctx: SortCtx<K>
  col: K
  className?: string
}) {
  const column = ctx.columns.find((c) => c.key === col)
  if (!column) return null
  const active = ctx.sort.key === col
  const dir = active ? ctx.sort.dir : null
  const target = nextDir(dir, column.firstDir ?? 'desc')
  return (
    <th
      className={`${th} ${className}`}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <Link
        href={sortHref(ctx, { key: col, dir: target })}
        scroll={false}
        title={`Sort by ${column.label}, ${target === 'asc' ? 'ascending' : 'descending'}`}
        className={`inline-flex items-center gap-1 uppercase transition hover:text-fg ${
          active ? 'text-fg' : ''
        }`}
      >
        {column.label}
        <span aria-hidden className={`text-[9px] ${active ? '' : 'opacity-30'}`}>
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </Link>
    </th>
  )
}

export function SortBar<K extends string>({ ctx }: { ctx: SortCtx<K> }) {
  const options = ctx.columns.flatMap((c) =>
    (['asc', 'desc'] as const).map((dir) => ({
      label: `${c.label} (${dir === 'asc' ? 'ascending' : 'descending'})`,
      href: sortHref(ctx, { key: c.key, dir }),
    })),
  )
  return <SortSelect options={options} value={sortHref(ctx, ctx.sort)} />
}
