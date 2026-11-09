import Link from 'next/link'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { RenderStatus } from '@reelset/core'
import { fmtBytes, fmtDate, fmtMs, truncate } from '@/lib/admin/format'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { parseSort, type SortState } from '@/lib/admin/sort'
import {
  SortBar,
  SortTh,
  sortQuery,
  type SortColumn,
  type SortCtx,
} from '@/components/admin/sortable'
import { mediaUrl } from '@/lib/media'
import {
  DiscardItemForm,
  Chips,
  Empty,
  Flash,
  Pager,
  PageTitle,
  Section,
  Status,
  Table,
  button,
  td,
  th,
} from '@/components/admin/ui'
import { retryRenderAction } from '@/app/admin/actions'
import { assertAdmin } from '@/server/admin/guard'
import { RENDER_SORT_KEYS, renderRows, type RenderSortKey } from '@/server/admin/queries'
import { getDb } from '@/server/db'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const STATUSES = Object.values(RenderStatus)
const DEFAULT_SORT: SortState<RenderSortKey> = { key: 'created', dir: 'desc' }
const COLUMNS: SortColumn<RenderSortKey>[] = [
  { key: 'created', label: 'Created (UTC)' },
  { key: 'title', label: 'Item', firstDir: 'asc' },
  { key: 'item_status', label: 'Item status', firstDir: 'asc' },
  { key: 'status', label: 'Render', firstDir: 'asc' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'render_ms', label: 'Render time' },
  { key: 'bytes', label: 'Bytes' },
  { key: 'error', label: 'Error', firstDir: 'asc' },
]

export default async function RendersPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const page = parsePage(sp.page, 20)
  const rawStatus = Array.isArray(sp.status) ? sp.status[0] : sp.status
  const status = STATUSES.find((s) => s === rawStatus) ?? null
  const base = process.env.MEDIA_PUBLIC_BASE_URL ?? ''

  const sort = parseSort(sp, RENDER_SORT_KEYS, DEFAULT_SORT)
  const ctx: SortCtx<RenderSortKey> = {
    path: '/admin/renders',
    params: { status: status ?? undefined },
    sort,
    fallback: DEFAULT_SORT,
    columns: COLUMNS,
  }
  const params = { ...ctx.params, ...sortQuery(ctx) }
  const renders = await renderRows(getDb(), page, status, sort)
  const returnTo = pageHref('/admin/renders', params, page.page)

  return (
    <div>
      <PageTitle title="Renders" />
      <Flash value={sp.flash} />
      <Section title="Renders">
        <div className="mb-3">
          <Chips
            active={status}
            items={[
              {
                key: 'all',
                label: 'all',
                href: pageHref('/admin/renders', { ...params, status: undefined }, 1),
              },
              ...STATUSES.map((s) => ({
                key: s,
                label: s,
                href: pageHref('/admin/renders', { ...params, status: s }, 1),
              })),
            ]}
          />
        </div>
        {renders.rows.length === 0 ? (
          <Empty>No renders</Empty>
        ) : (
          <>
            <SortBar ctx={ctx} />
            <Table>
              <thead>
                <tr>
                  <SortTh ctx={ctx} col="created" />
                  <SortTh ctx={ctx} col="title" />
                  <SortTh ctx={ctx} col="item_status" />
                  <SortTh ctx={ctx} col="status" />
                  <SortTh ctx={ctx} col="attempts" />
                  <SortTh ctx={ctx} col="render_ms" />
                  <SortTh ctx={ctx} col="bytes" />
                  <th className={th}>Video</th>
                  <SortTh ctx={ctx} col="error" />
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {renders.rows.map((r) => {
                  const url = base ? mediaUrl(base, r.video_key) : null
                  return (
                    <tr key={r.id}>
                      <td className={td}>{fmtDate(r.created_at)}</td>
                      <td className={td}>
                        <Link href={`/admin?item=${r.item_id}`}>{truncate(r.title, 60)}</Link>
                      </td>
                      <td className={td}>
                        <Status value={r.item_status} />
                      </td>
                      <td className={td}>
                        <Status value={r.status} />
                      </td>
                      <td className={td}>{r.attempts}</td>
                      <td className={td}>{fmtMs(r.render_ms)}</td>
                      <td className={td}>{fmtBytes(r.bytes)}</td>
                      <td className={td}>
                        {url && r.status === 'done' ? (
                          <video src={url} controls preload="none" className="h-28 rounded" />
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={`${td} text-danger`}>{truncate(r.error, 200)}</td>
                      <td className={td}>
                        {r.status === 'failed' ? (
                          <div className="flex gap-2">
                            <form action={retryRenderAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <SubmitButton className={button} pendingLabel="Retrying">
                                Retry
                              </SubmitButton>
                            </form>
                            {r.item_status === 'failed' ? (
                              <DiscardItemForm itemId={r.item_id} returnTo={returnTo} />
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </>
        )}
        <Pager path="/admin/renders" params={params} page={page.page} hasMore={renders.hasMore} />
      </Section>
    </div>
  )
}
