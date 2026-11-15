import Link from 'next/link'
import { ItemStatus, Source } from '@reelset/core'
import { fmtDate, truncate } from '@/lib/admin/format'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
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
  Flash,
  Pager,
  Status,
  Table,
  Toolbar,
  button,
  buttonPrimary,
  input,
  td,
  th,
} from '@/components/admin/ui'
import { BULK_FORM_ID, BulkHideBar } from '@/components/admin/moderation/BulkHideBar'
import { HideControls } from '@/components/admin/moderation/HideControls'
import { SelectAllCheckbox } from '@/components/admin/moderation/SelectAllCheckbox'
import { VisibilityBadge } from '@/components/admin/moderation/VisibilityBadge'
import { SourceDot } from '@/components/ui/sources'
import { assertAdmin } from '@/server/admin/guard'
import { viewerTimeZone } from '@/server/timezone'
import { zoneHint } from '@/lib/time/zone'
import {
  VISIBILITY_FILTERS,
  VISIBILITY_FILTER_LABELS,
  parseVisibilityFilter,
} from '@/lib/admin/moderation'
import { listSpamSuspects, visibilityCounts } from '@/server/admin/moderation'
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
  { key: 'changed', label: 'Changed' },
]
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ItemsPage({ searchParams }: Props) {
  await assertAdmin()
  const tz = await viewerTimeZone()
  const sp = await searchParams
  const page = parsePage(sp.page, 30)
  const source = SOURCES.find((s) => s === first(sp.source)) ?? null
  const status = STATUSES.find((s) => s === first(sp.status)) ?? null
  const q = first(sp.q)?.trim().slice(0, 80) || null

  const sort = parseSort(sp, ITEM_SORT_KEYS, DEFAULT_SORT)
  const visibility = parseVisibilityFilter(sp.visibility)
  const db = getDb()
  const [counts, suspects] = await Promise.all([visibilityCounts(db), listSpamSuspects(db)])
  const suspectsById = new Map(suspects.map((s) => [s.id, s]))
  const items = await listItems(
    db,
    page,
    {
      source,
      status,
      q,
      visibility: visibility && visibility !== 'suspected' ? visibility : null,
      ids: visibility === 'suspected' ? suspects.map((s) => s.id) : null,
    },
    sort,
  )
  const filterParams = {
    visibility: visibility ?? undefined,
    source: source ?? undefined,
    status: status ?? undefined,
    q: q ?? undefined,
  }
  const ctx: SortCtx<ItemSortKey> = {
    path: ADMIN_ROUTES.items,
    params: filterParams,
    sort,
    fallback: DEFAULT_SORT,
    columns: COLUMNS,
  }
  const params = { ...filterParams, ...sortQuery(ctx) }
  const href = (patch: Record<string, string | undefined>) =>
    pageHref(ADMIN_ROUTES.items, { ...params, ...patch }, 1)
  const returnTo = pageHref(ADMIN_ROUTES.items, params, page.page)
  const visibilityCount: Record<(typeof VISIBILITY_FILTERS)[number], number> = {
    ...counts,
    suspected: suspects.length,
  }

  return (
    <div>
      <Flash value={sp.flash} />
      <Toolbar
        hint={`Every item the pipeline has seen. Select one to open its timeline, or tick rows to hide them. ${zoneHint(tz)}`}
      />
      <div className="mb-5 flex flex-col gap-3">
        <form method="get" action={ADMIN_ROUTES.items} className="flex gap-2">
          {visibility && <input type="hidden" name="visibility" value={visibility} />}
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
          {(visibility || source || status || q) && (
            <Link href="/admin/items" className={button}>
              Clear
            </Link>
          )}
        </form>
        <Chips
          active={visibility}
          items={[
            { key: 'all', label: `All (${counts.all})`, href: href({ visibility: undefined }) },
            ...VISIBILITY_FILTERS.map((v) => ({
              key: v,
              label: `${VISIBILITY_FILTER_LABELS[v]} (${visibilityCount[v]})`,
              href: href({ visibility: v }),
            })),
          ]}
        />
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
          <BulkHideBar returnTo={returnTo} count={items.rows.length} />
          <Table>
            <thead>
              <tr>
                <th className={th}>
                  <SelectAllCheckbox formId={BULK_FORM_ID} />
                </th>
                {COLUMNS.map((c) => (
                  <SortTh key={c.key} ctx={ctx} col={c.key} />
                ))}
                <th className={th}>Moderation</th>
              </tr>
            </thead>
            <tbody>
              {items.rows.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <input
                      type="checkbox"
                      name="itemId"
                      value={i.id}
                      form={BULK_FORM_ID}
                      aria-label={`Select ${truncate(i.title, 60)}`}
                    />
                  </td>
                  <td className={td}>
                    <Link
                      href={`${ADMIN_ROUTES.pipeline}?item=${i.id}`}
                      className="text-fg hover:text-info"
                    >
                      {truncate(i.title, 90)}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-x-2">
                      <VisibilityBadge visibility={i.visibility} reason={i.hidden_reason} />
                      {i.hidden_at && (
                        <span className="text-xs text-faint">{fmtDate(i.hidden_at, tz)}</span>
                      )}
                    </div>
                    {suspectsById.get(i.id) && (
                      <div className="mt-0.5 text-xs text-warn">
                        {suspectsById.get(i.id)!.verdict.reasons.join(' · ')}
                      </div>
                    )}
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
                    {fmtDate(i.status_changed_at, tz)}
                  </td>
                  <td className={td}>
                    <HideControls itemId={i.id} visibility={i.visibility} returnTo={returnTo} />
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
