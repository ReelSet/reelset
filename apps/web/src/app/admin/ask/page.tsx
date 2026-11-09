import { AskOutcome } from '@reelset/core'
import { fmtDate, fmtMs, truncate } from '@/lib/admin/format'
import { parsePage } from '@/lib/admin/pagination'
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
import { askLog } from '@/server/admin/queries'
import { getDb } from '@/server/db'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const OUTCOMES = Object.values(AskOutcome)

export default async function AskLogPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const page = parsePage(sp.page, 25)
  const rawOutcome = Array.isArray(sp.outcome) ? sp.outcome[0] : sp.outcome
  const outcome = OUTCOMES.find((o) => o === rawOutcome) ?? null

  const log = await askLog(getDb(), page, outcome)

  return (
    <div>
      <PageTitle title="Ask log" hint="Questions asked through /ask and how they resolved." />
      <Section title="Recent questions">
        <div className="mb-3">
          <Chips
            active={outcome}
            items={[
              { key: 'all', label: 'all', href: '/admin/ask' },
              ...OUTCOMES.map((o) => ({ key: o, label: o, href: `/admin/ask?outcome=${o}` })),
            ]}
          />
        </div>
        {log.rows.length === 0 ? (
          <Empty>No Ask queries</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>When (UTC)</th>
                <th className={th}>Outcome</th>
                <th className={th}>Latency</th>
                <th className={th}>Question</th>
                <th className={th}>Answer</th>
                <th className={th}>Citations</th>
                <th className={th}>Tokens in/out</th>
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
                  <td className={td}>
                    {q.input_tokens ?? '-'} / {q.output_tokens ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager
          path="/admin/ask"
          params={{ outcome: outcome ?? undefined }}
          page={page.page}
          hasMore={log.hasMore}
        />
      </Section>
    </div>
  )
}
