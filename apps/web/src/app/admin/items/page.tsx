import Link from 'next/link'
import { ItemStatus, Source } from '@reelset/core'
import { fmtDate, truncate } from '@/lib/admin/format'
import { pageHref, parsePage } from '@/lib/admin/pagination'
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
  th,
} from '@/components/admin/ui'
import { SourceDot } from '@/components/ui/sources'
import { assertAdmin } from '@/server/admin/guard'
import { listItems } from '@/server/admin/queries'
import { getDb } from '@/server/db'

export const metadata = { title: 'Items' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const SOURCES: string[] = Object.values(Source)
const STATUSES = Object.values(ItemStatus)
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ItemsPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const page = parsePage(sp.page, 30)
  const source = SOURCES.find((s) => s === first(sp.source)) ?? null
  const status = STATUSES.find((s) => s === first(sp.status)) ?? null
  const q = first(sp.q)?.trim().slice(0, 80) || null

  const items = await listItems(getDb(), page, { source, status, q })
  const params = { source: source ?? undefined, status: status ?? undefined, q: q ?? undefined }
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
        <Table>
          <thead>
            <tr>
              <th className={th}>Title</th>
              <th className={th}>Source</th>
              <th className={th}>Status</th>
              <th className={th}>Score</th>
              <th className={th}>Attempts</th>
              <th className={th}>Changed (UTC)</th>
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
                    <div className="mt-0.5 text-xs text-danger">{truncate(i.last_error, 120)}</div>
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
                <td className={`${td} tabular-nums`}>{i.attempts}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>
                  {fmtDate(i.status_changed_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pager path="/admin/items" params={params} page={page.page} hasMore={items.hasMore} />
    </div>
  )
}
