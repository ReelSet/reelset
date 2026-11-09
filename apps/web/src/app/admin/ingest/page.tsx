import Link from 'next/link'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { z } from 'zod'
import { fmtDate, fmtMs, truncate } from '@/lib/admin/format'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { parseSort, sortParams, type SortState } from '@/lib/admin/sort'
import {
  SortBar,
  SortTh,
  sortQuery,
  type SortColumn,
  type SortCtx,
} from '@/components/admin/sortable'
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
import {
  RUN_SORT_KEYS,
  TASK_SORT_KEYS,
  ingestRuns,
  ingestTasks,
  latestRunId,
  type RunSortKey,
  type TaskSortKey,
} from '@/server/admin/queries'
import { getDb } from '@/server/db'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const RUN_DEFAULT: SortState<RunSortKey> = { key: 'started', dir: 'desc' }
const RUN_COLUMNS: SortColumn<RunSortKey>[] = [
  { key: 'started', label: 'Started (UTC)' },
  { key: 'mode', label: 'Mode', firstDir: 'asc' },
  { key: 'status', label: 'Status', firstDir: 'asc' },
  { key: 'duration', label: 'Duration' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'failed', label: 'Failed' },
]
const TASK_NAMES = { sort: 'tsort', dir: 'tdir' }
const TASK_DEFAULT: SortState<TaskSortKey> = { key: 'position', dir: 'asc' }
const TASK_COLUMNS: SortColumn<TaskSortKey>[] = [
  { key: 'position', label: '#', firstDir: 'asc' },
  { key: 'source', label: 'Source', firstDir: 'asc' },
  { key: 'scope', label: 'Scope', firstDir: 'asc' },
  { key: 'status', label: 'Status', firstDir: 'asc' },
  { key: 'fetched', label: 'Fetched' },
  { key: 'inserted', label: 'Inserted' },
  { key: 'updated', label: 'Updated' },
  { key: 'duration', label: 'Duration' },
  { key: 'error', label: 'Error', firstDir: 'asc' },
]

export default async function IngestPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const page = parsePage(sp.page, 20)

  const requested = z.guid().safeParse(Array.isArray(sp.run) ? sp.run[0] : sp.run)
  const runSort = parseSort(sp, RUN_SORT_KEYS, RUN_DEFAULT)
  const taskSort = parseSort(sp, TASK_SORT_KEYS, TASK_DEFAULT, TASK_NAMES)
  const runs = await ingestRuns(db, page, runSort)
  const runId = requested.success ? requested.data : await latestRunId(db)
  const tasks = runId ? await ingestTasks(db, runId, taskSort) : []
  const runCtx: SortCtx<RunSortKey> = {
    path: '/admin/ingest',
    params: {
      run: requested.success ? requested.data : undefined,
      ...sortParams(taskSort, TASK_DEFAULT, TASK_NAMES),
    },
    sort: runSort,
    fallback: RUN_DEFAULT,
    columns: RUN_COLUMNS,
  }
  const taskCtx: SortCtx<TaskSortKey> = {
    path: '/admin/ingest',
    params: {
      run: runId ?? undefined,
      page: page.page > 1 ? String(page.page) : undefined,
      ...sortQuery(runCtx),
    },
    sort: taskSort,
    fallback: TASK_DEFAULT,
    columns: TASK_COLUMNS,
    names: TASK_NAMES,
  }
  const runPageParams = { ...runCtx.params, ...sortQuery(runCtx) }
  const returnTo = pageHref(
    '/admin/ingest',
    { run: runId ?? undefined, ...sortQuery(runCtx), ...sortQuery(taskCtx) },
    page.page,
  )

  return (
    <div>
      <PageTitle title="Ingest runs" />
      <Flash value={sp.flash} />
      <Section title="Ingest runs">
        {runs.rows.length === 0 ? (
          <Empty>No ingest runs yet</Empty>
        ) : (
          <>
            <SortBar ctx={runCtx} />
            <Table>
              <thead>
                <tr>
                  {RUN_COLUMNS.map((c) => (
                    <SortTh key={c.key} ctx={runCtx} col={c.key} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.rows.map((r) => (
                  <tr key={r.id} className={r.id === runId ? 'bg-white/[0.04]' : ''}>
                    <td className={td}>
                      <Link
                        href={pageHref('/admin/ingest', { ...runPageParams, run: r.id }, page.page)}
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
                        ? fmtMs(
                            new Date(r.finished_at).getTime() - new Date(r.started_at).getTime(),
                          )
                        : '-'}
                    </td>
                    <td className={td}>{r.task_count}</td>
                    <td className={td}>{r.failed_count}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
        <Pager
          path="/admin/ingest"
          params={runPageParams}
          page={page.page}
          hasMore={runs.hasMore}
        />
      </Section>

      <Section title="Tasks in selected run">
        {tasks.length === 0 ? (
          <Empty>No tasks</Empty>
        ) : (
          <>
            <SortBar ctx={taskCtx} />
            <Table>
              <thead>
                <tr>
                  {TASK_COLUMNS.map((c) => (
                    <SortTh key={c.key} ctx={taskCtx} col={c.key} />
                  ))}
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
                          <SubmitButton className={button} pendingLabel="Retrying">
                            Retry
                          </SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
        <p className="mt-2 text-xs text-faint">
          Retry marks the task deferred. Ingest runs on Cloudflare, so the next cron run picks it
          up.
        </p>
      </Section>
    </div>
  )
}
