import { AskOutcome } from '@reelset/core'
import { fmtDate, fmtMs, truncate } from '@/lib/admin/format'
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
  PageTitle,
  Section,
  Status,
  Table,
  td,
  th,
} from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import { ASK_SORT_KEYS, askLog, type AskSortKey } from '@/server/admin/queries'
import { getDb } from '@/server/db'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const OUTCOMES = Object.values(AskOutcome)
const DEFAULT_SORT: SortState<AskSortKey> = { key: 'when', dir: 'desc' }
const COLUMNS: SortColumn<AskSortKey>[] = [
  { key: 'when', label: 'When (UTC)' },
  { key: 'outcome', label: 'Outcome', firstDir: 'asc' },
  { key: 'latency', label: 'Latency' },
  { key: 'question', label: 'Question', firstDir: 'asc' },
  { key: 'tokens_in', label: 'Tokens in' },
  { key: 'tokens_out', label: 'Tokens out' },
]

export default async function AskLogPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const page = parsePage(sp.page, 25)
  const rawOutcome = Array.isArray(sp.outcome) ? sp.outcome[0] : sp.outcome
  const outcome = OUTCOMES.find((o) => o === rawOutcome) ?? null

  const sort = parseSort(sp, ASK_SORT_KEYS, DEFAULT_SORT)
  const ctx: SortCtx<AskSortKey> = {
    path: '/admin/ask',
    params: { outcome: outcome ?? undefined },
    sort,
    fallback: DEFAULT_SORT,
    columns: COLUMNS,
  }
  const params = { ...ctx.params, ...sortQuery(ctx) }
  const log = await askLog(getDb(), page, outcome, sort)

  return (
    <div>
      <PageTitle title="Ask log" hint="Questions asked through /ask and how they resolved." />
      <Section title="Recent questions">
        <div className="mb-3">
          <Chips
            active={outcome}
            items={[
              {
                key: 'all',
                label: 'all',
                href: pageHref('/admin/ask', { ...params, outcome: undefined }, 1),
              },
              ...OUTCOMES.map((o) => ({
                key: o,
                label: o,
                href: pageHref('/admin/ask', { ...params, outcome: o }, 1),
              })),
            ]}
          />
        </div>
        {log.rows.length === 0 ? (
          <Empty>No Ask queries</Empty>
        ) : (
          <>
            <SortBar ctx={ctx} />
            <Table>
              <thead>
                <tr>
                  <SortTh ctx={ctx} col="when" />
                  <SortTh ctx={ctx} col="outcome" />
                  <SortTh ctx={ctx} col="latency" />
                  <SortTh ctx={ctx} col="question" />
                  <th className={th}>Answer</th>
                  <th className={th}>Citations</th>
                  <SortTh ctx={ctx} col="tokens_in" />
                  <SortTh ctx={ctx} col="tokens_out" />
                </tr>
              </thead>
              <tbody>
                {log.rows.map((q) => (
                  <tr key={q.id}>
                    <td className={td}>{fmtDate(q.created_at)}</td>
                    <td className={td}>
                      <Status value={q.outcome} />
                    </td>
                    <td className={td}>{fmtMs(q.latency_ms)}</td>
                    <td className={td}>{truncate(q.question, 140)}</td>
                    <td className={`${td} text-faint`}>{truncate(q.answer, 160)}</td>
                    <td className={td}>{Array.isArray(q.citations) ? q.citations.length : 0}</td>
                    <td className={td}>{q.input_tokens ?? '-'}</td>
                    <td className={td}>{q.output_tokens ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
        <Pager path="/admin/ask" params={params} page={page.page} hasMore={log.hasMore} />
      </Section>
    </div>
  )
}
