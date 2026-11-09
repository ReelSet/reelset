import Link from 'next/link'
import { z } from 'zod'
import { fmtDate, fmtMs, truncate } from '@/lib/admin/format'
import { parsePage } from '@/lib/admin/pagination'
import { suggestRetryStage } from '@/lib/admin/retry'
import {
  DiscardItemForm,
  Empty,
  Flash,
  Pager,
  button,
  input,
  RetryItemForm,
  PageTitle,
  Section,
  Stat,
  Status,
  Table,
  td,
  th,
} from '@/components/admin/ui'
import { SourceDot } from '@/components/ui/sources'
import { assertAdmin } from '@/server/admin/guard'
import {
  failedItems,
  itemTimeline,
  sourceStatusMatrix,
  statusCounts,
  stuckItems,
  STUCK_MINUTES,
} from '@/server/admin/queries'
import { getDb } from '@/server/db'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function PipelinePage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const page = parsePage(sp.page, 25)
  const itemId = z.guid().safeParse(Array.isArray(sp.item) ? sp.item[0] : sp.item)

  const [counts, matrix, stuck, failed, timeline] = await Promise.all([
    statusCounts(db),
    sourceStatusMatrix(db),
    stuckItems(db),
    failedItems(db, page),
    itemId.success ? itemTimeline(db, itemId.data) : Promise.resolve(null),
  ])

  const byStatus = new Map(counts.map((c) => [c.status, c.count]))
  const total = counts.reduce((sum, c) => sum + c.count, 0)
  const terminal = new Set(['rendered', 'failed', 'insufficient_source'])
  const inFlight = counts
    .filter((c) => !terminal.has(c.status))
    .reduce((sum, c) => sum + c.count, 0)
  const cell = new Map(matrix.map((m) => [`${m.source}:${m.status}`, m.count]))
  const rowTotal = new Map<string, number>()
  for (const m of matrix) rowTotal.set(m.source, (rowTotal.get(m.source) ?? 0) + m.count)
  const sources = [...rowTotal.keys()].sort(
    (a, b) => (rowTotal.get(b) ?? 0) - (rowTotal.get(a) ?? 0),
  )
  const peak = Math.max(1, ...matrix.filter((m) => m.status !== 'found').map((m) => m.count))

  return (
    <div>
      <Flash value={sp.flash} />

      <PageTitle title="Pipeline" hint="Items by source and status. Select a cell to list them." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total items" value={total} />
        <Stat label="In feed" value={byStatus.get('rendered') ?? 0} tone="ok" />
        <Stat label="In flight" value={inFlight} />
        <Stat
          label="Failed"
          value={byStatus.get('failed') ?? 0}
          tone={byStatus.get('failed') ? 'danger' : undefined}
        />
      </div>

      <Section title="Source by status">
        <Table>
          <thead>
            <tr>
              <th className={th}>Source</th>
              {counts.map((c) => (
                <th key={c.status} className={`${th} text-right`}>
                  {c.status}
                </th>
              ))}
              <th className={`${th} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src) => (
              <tr key={src}>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5">
                    <SourceDot source={src} />
                    {src}
                  </span>
                </td>
                {counts.map((c) => {
                  const n = cell.get(`${src}:${c.status}`) ?? 0
                  return (
                    <td key={c.status} className={`${td} text-right tabular-nums`}>
                      {n ? (
                        <Link
                          href={`/admin/items?source=${src}&status=${c.status}`}
                          className="rounded px-1.5 py-0.5 text-fg transition hover:bg-hover"
                          style={{
                            background: `rgb(200 247 81 / ${Math.min(0.18, (n / peak) * 0.18)})`,
                          }}
                        >
                          {n}
                        </Link>
                      ) : (
                        <span className="text-faint/50">0</span>
                      )}
                    </td>
                  )
                })}
                <td className={`${td} text-right font-medium tabular-nums`}>
                  {rowTotal.get(src) ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Item timeline">
        <form className="mb-3 flex gap-2" method="get" action="/admin">
          <input
            name="item"
            placeholder="item id (uuid)"
            defaultValue={itemId.success ? itemId.data : ''}
            className={`${input} w-96 max-w-full font-mono text-xs`}
          />
          <button type="submit" className={button}>
            Show
          </button>
        </form>
        {itemId.success && !timeline ? <Empty>No item with that id</Empty> : null}
        {timeline ? (
          <div>
            <div className="mb-3 rounded-md border border-line bg-surface p-4">
              <p className="text-[15px] font-medium leading-snug">{timeline.item.title}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <Status value={timeline.item.status} />
                <span>attempts {timeline.item.attempts}</span>
                <span>queued {fmtDate(timeline.item.queued_at)}</span>
                <a href={timeline.item.canonical_url} target="_blank" rel="noreferrer">
                  source
                </a>
              </p>
            </div>
            {timeline.item.last_error ? (
              <p className="mb-2 text-xs text-danger">{timeline.item.last_error}</p>
            ) : null}
            {timeline.item.status === 'failed' ? (
              <div className="mb-3 flex gap-3">
                <RetryItemForm
                  itemId={timeline.item.id}
                  defaultStage={suggestRetryStage(
                    timeline.events.find((e) => e.outcome === 'ok' && e.stage !== 'failed')?.stage,
                  )}
                  returnTo={`/admin?item=${timeline.item.id}`}
                />
                <DiscardItemForm
                  itemId={timeline.item.id}
                  returnTo={`/admin?item=${timeline.item.id}`}
                />
              </div>
            ) : null}
            <Table>
              <thead>
                <tr>
                  <th className={th}>When (UTC)</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Outcome</th>
                  <th className={th}>Attempt</th>
                  <th className={th}>Duration</th>
                  <th className={th}>Error</th>
                  <th className={th}>Meta</th>
                </tr>
              </thead>
              <tbody>
                {timeline.events.map((e) => (
                  <tr key={String(e.id)}>
                    <td className={td}>{fmtDate(e.created_at)}</td>
                    <td className={td}>{e.stage}</td>
                    <td className={td}>
                      <Status value={e.outcome} />
                    </td>
                    <td className={td}>{e.attempt}</td>
                    <td className={td}>{fmtMs(e.duration_ms)}</td>
                    <td className={`${td} text-danger`}>{truncate(e.error, 300)}</td>
                    <td className={`${td} font-mono text-faint`}>
                      {e.meta ? truncate(JSON.stringify(e.meta), 160) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </Section>

      <Section title={`Stuck items (queued more than ${STUCK_MINUTES} min ago)`}>
        {stuck.length === 0 ? (
          <Empty>No stuck items</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Status</th>
                <th className={th}>Attempts</th>
                <th className={th}>Queued at</th>
                <th className={th}>Last error</th>
              </tr>
            </thead>
            <tbody>
              {stuck.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <Link href={`/admin?item=${i.id}`}>{truncate(i.title, 80)}</Link>
                  </td>
                  <td className={td}>{i.status}</td>
                  <td className={td}>{i.attempts}</td>
                  <td className={td}>{fmtDate(i.queued_at)}</td>
                  <td className={`${td} text-danger`}>{truncate(i.last_error, 120)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Failed items">
        {failed.rows.length === 0 ? (
          <Empty>No failed items</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Failed at</th>
                <th className={th}>Attempts</th>
                <th className={th}>Error</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {failed.rows.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <Link href={`/admin?item=${i.id}`}>{truncate(i.title, 80)}</Link>
                  </td>
                  <td className={td}>{fmtDate(i.status_changed_at)}</td>
                  <td className={td}>{i.attempts}</td>
                  <td className={`${td} text-danger`}>{truncate(i.last_error, 200)}</td>
                  <td className={td}>
                    <div className="flex gap-3">
                      <RetryItemForm
                        itemId={i.id}
                        defaultStage={suggestRetryStage(i.last_ok_stage)}
                        returnTo={page.page > 1 ? `/admin?page=${page.page}` : '/admin'}
                      />
                      <DiscardItemForm
                        itemId={i.id}
                        returnTo={page.page > 1 ? `/admin?page=${page.page}` : '/admin'}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager path="/admin" params={{}} page={page.page} hasMore={failed.hasMore} />
      </Section>
    </div>
  )
}
