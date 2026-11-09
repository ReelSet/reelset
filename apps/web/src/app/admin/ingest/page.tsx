import Link from 'next/link'
import { z } from 'zod'
import { fmtDate, fmtMs, truncate } from '@/lib/admin/format'
import { parsePage } from '@/lib/admin/pagination'
import {
  PageTitle,
  Empty,
  Flash,
  Pager,
  Section,
  Status,
  Table,
  button,
  td,
  th,
} from '@/components/admin/ui'
import { retryTaskAction } from '@/app/admin/actions'
import { assertAdmin } from '@/server/admin/guard'
import { ingestRuns, ingestTasks, latestRunId } from '@/server/admin/queries'
import { getDb } from '@/server/db'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function IngestPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const page = parsePage(sp.page, 20)

  const requested = z.guid().safeParse(Array.isArray(sp.run) ? sp.run[0] : sp.run)
  const runs = await ingestRuns(db, page)
  const runId = requested.success ? requested.data : await latestRunId(db)
  const tasks = runId ? await ingestTasks(db, runId) : []
  const returnTo = `/admin/ingest${runId ? `?run=${runId}` : ''}`

  return (
    <div>
      <PageTitle title="Ingest runs" />
      <Flash value={sp.flash} />
      <Section title="Ingest runs">
        {runs.rows.length === 0 ? (
          <Empty>No ingest runs yet</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Started (UTC)</th>
                <th className={th}>Mode</th>
                <th className={th}>Status</th>
                <th className={th}>Duration</th>
                <th className={th}>Tasks</th>
                <th className={th}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {runs.rows.map((r) => (
                <tr key={r.id} className={r.id === runId ? 'bg-white/[0.04]' : ''}>
                  <td className={td}>
                    <Link
                      href={`/admin/ingest?run=${r.id}${page.page > 1 ? `&page=${page.page}` : ''}`}
                    >
                      {fmtDate(r.started_at)}
                    </Link>
                  </td>
                  <td className={td}>{r.mode}</td>
                  <td className={td}>
                    <Status value={r.status} />
                  </td>
                  <td className={td}>
                    {r.finished_at
                      ? fmtMs(new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())
                      : '-'}
                  </td>
                  <td className={td}>{r.task_count}</td>
                  <td className={td}>{r.failed_count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager path="/admin/ingest" params={{}} page={page.page} hasMore={runs.hasMore} />
      </Section>

      <Section title="Tasks in selected run">
        {tasks.length === 0 ? (
          <Empty>No tasks</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>#</th>
                <th className={th}>Source</th>
                <th className={th}>Scope</th>
                <th className={th}>Status</th>
                <th className={th}>Fetched</th>
                <th className={th}>Inserted</th>
                <th className={th}>Updated</th>
                <th className={th}>Duration</th>
                <th className={th}>Error</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className={td}>{t.position}</td>
                  <td className={td}>{t.source}</td>
                  <td className={td}>{truncate(t.scope, 40)}</td>
                  <td className={td}>
                    <Status value={t.status} />
                  </td>
                  <td className={td}>{t.fetched}</td>
                  <td className={td}>{t.inserted}</td>
                  <td className={td}>{t.updated}</td>
                  <td className={td}>{fmtMs(t.duration_ms)}</td>
                  <td className={`${td} text-danger`}>{truncate(t.error, 200)}</td>
                  <td className={td}>
                    {t.status === 'failed' ? (
                      <form action={retryTaskAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" className={button}>
                          Retry
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-faint">
          Retry marks the task deferred. Ingest runs on Cloudflare, so the next cron run picks it
          up.
        </p>
      </Section>
    </div>
  )
}
