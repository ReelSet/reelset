import Link from 'next/link'
import { ItemStatus, Source } from '@reelset/core'
import { fmtDate, truncate } from '@/lib/admin/format'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { parseSort, type SortState } from '@/lib/admin/sort'
import {
  SortBar,
  SortTh,
  sortQuery,
  type SortColumn,
  type SortCtx,
} from '@/components/admin/sortable'
import {
  Chips,
  Empty,
  Pager,
  Status,
  Table,
  PageTitle,
  button,
  buttonPrimary,
  input,
  td,
} from '@/components/admin/ui'
import { SourceDot } from '@/components/ui/sources'
import { assertAdmin } from '@/server/admin/guard'
import { ITEM_SORT_KEYS, listItems, type ItemSortKey } from '@/server/admin/queries'
import { getDb } from '@/server/db'

export const metadata = { title: 'Items' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const SOURCES: string[] = Object.values(Source)
const STATUSES = Object.values(ItemStatus)
const DEFAULT_SORT: SortState<ItemSortKey> = { key: 'changed', dir: 'desc' }
const COLUMNS: SortColumn<ItemSortKey>[] = [
  { key: 'title', label: 'Title', firstDir: 'asc' },
  { key: 'source', label: 'Source', firstDir: 'asc' },
  { key: 'status', label: 'Status', firstDir: 'asc' },
  { key: 'score', label: 'Score' },
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'changed', label: 'Changed (UTC)' },
]
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ItemsPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const page = parsePage(sp.page, 30)
  const source = SOURCES.find((s) => s === first(sp.source)) ?? null
  const status = STATUSES.find((s) => s === first(sp.status)) ?? null
  const q = first(sp.q)?.trim().slice(0, 80) || null

  const sort = parseSort(sp, ITEM_SORT_KEYS, DEFAULT_SORT)
  const items = await listItems(getDb(), page, { source, status, q }, sort)
  const filterParams = {
    source: source ?? undefined,
    status: status ?? undefined,
    q: q ?? undefined,
  }
  const ctx: SortCtx<ItemSortKey> = {
    path: '/admin/items',
    params: filterParams,
    sort,
    fallback: DEFAULT_SORT,
    columns: COLUMNS,
  }
  const params = { ...filterParams, ...sortQuery(ctx) }
  const href = (patch: Record<string, string | undefined>) =>
    pageHref('/admin/items', { ...params, ...patch }, 1)

  return (
    <div>
      <PageTitle
        title="Items"
        hint="Every item the pipeline has seen. Select one to open its timeline."
      />
      <div className="mb-5 flex flex-col gap-3">
        <form method="get" action="/admin/items" className="flex gap-2">
          {source && <input type="hidden" name="source" value={source} />}
          {status && <input type="hidden" name="status" value={status} />}
          {Object.entries(sortQuery(ctx)).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search titles"
            className={`${input} w-72`}
          />
          <button type="submit" className={buttonPrimary}>
            Search
          </button>
          {(source || status || q) && (
            <Link href="/admin/items" className={button}>
              Clear
            </Link>
          )}
        </form>
        <Chips
          active={source}
          items={[
            { key: 'all', label: 'All sources', href: href({ source: undefined }) },
            ...SOURCES.map((s) => ({ key: s, label: s, href: href({ source: s }) })),
          ]}
        />
        <Chips
          active={status}
          items={[
            { key: 'all', label: 'Any status', href: href({ status: undefined }) },
            ...STATUSES.map((s) => ({ key: s, label: s, href: href({ status: s }) })),
          ]}
        />
      </div>

      {items.rows.length === 0 ? (
        <Empty>No items match these filters</Empty>
      ) : (
        <>
          <SortBar ctx={ctx} />
          <Table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <SortTh key={c.key} ctx={ctx} col={c.key} />
                ))}
              </tr>
            </thead>
            <tbody>
              {items.rows.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <Link href={`/admin?item=${i.id}`} className="text-fg hover:text-info">
                      {truncate(i.title, 90)}
                    </Link>
                    {i.last_error && (
                      <div className="mt-0.5 text-xs text-danger">
                        {truncate(i.last_error, 120)}
                      </div>
                    )}
                  </td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-1.5">
                      <SourceDot source={i.source} />
                      {i.source}
                    </span>
                  </td>
                  <td className={td}>
                    <Status value={i.status} />
                  </td>
                  <td className={`${td} tabular-nums`}>{i.score.toFixed(1)}</td>
                  <td className={`${td} tabular-nums`}>{i.view_count}</td>
                  <td className={`${td} tabular-nums`}>{Number(i.like_count)}</td>
                  <td className={`${td} tabular-nums`}>{i.attempts}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>
                    {fmtDate(i.status_changed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      <Pager path="/admin/items" params={params} page={page.page} hasMore={items.hasMore} />
    </div>
  )
}
