import { SETTINGS, SpendCategory, getSetting } from '@reelset/core'
import { fmtPct, fmtUsd } from '@/lib/admin/format'
import { capUsage, splitSpend } from '@/lib/admin/spend'
import { PageTitle, Section, Stat, Table, td, th } from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import { spendLedger } from '@/server/admin/queries'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

const CATEGORIES = Object.values(SpendCategory)
const COLORS: Record<string, string> = {
  llm: '#c8f751',
  embedding: '#6cb6ff',
  tts: '#f5b84b',
  render: '#b4a0ff',
  ask: '#ff7a29',
}
const color = (c: string) => COLORS[c] ?? '#a1a1aa'

export default async function SpendPage() {
  await assertAdmin()
  const db = getDb()
  const log = routeLog('admin/spend')
  const [days, pipelineCap, askCap] = await Promise.all([
    spendLedger(db),
    getSetting(db, SETTINGS.pipelineDailySpendCapUsd, log),
    getSetting(db, SETTINGS.askDailySpendCapUsd, log),
  ])

  const ordered = [...days].reverse()
  const peak = Math.max(0.0001, ...ordered.map((d) => d.totalUsd))
  const today = days[0]
  const todaySplit = today ? splitSpend(today.byCategory) : { pipelineUsd: 0, askUsd: 0 }

  return (
    <div>
      <PageTitle title="Spend" hint="Daily cost by category, UTC." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pipeline today" value={fmtUsd(todaySplit.pipelineUsd)} />
        <Stat label="Pipeline cap" value={fmtUsd(pipelineCap)} />
        <Stat label="Ask today" value={fmtUsd(todaySplit.askUsd)} />
        <Stat label="Ask cap" value={fmtUsd(askCap)} />
      </div>
      <Section
        title="Last 14 days"
        aside={
          <ul className="flex flex-wrap gap-3 text-xs text-muted">
            {CATEGORIES.map((c) => (
              <li key={c} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: color(c) }} />
                {c}
              </li>
            ))}
          </ul>
        }
      >
        <div className="rounded-md border border-line bg-surface p-4">
          <div
            className="flex h-44 items-end gap-1.5"
            role="img"
            aria-label="Daily spend, stacked by category"
          >
            {ordered.map((d) => (
              <div
                key={d.day}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${d.day}: ${fmtUsd(d.totalUsd)}`}
              >
                <div
                  className="flex flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity group-hover:opacity-80"
                  style={{ height: `${(d.totalUsd / peak) * 100}%` }}
                >
                  {CATEGORIES.map((c) => (
                    <div key={c} style={{ background: color(c), flex: d.byCategory[c] ?? 0 }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-faint">
            <span>{ordered[0]?.day}</span>
            <span>peak {fmtUsd(peak)}</span>
            <span>{ordered[ordered.length - 1]?.day}</span>
          </div>
        </div>
      </Section>
      <Section title="Daily breakdown">
        <p className="mb-3 text-xs text-faint">
          Caps per day: pipeline (llm, embedding, tts, render) {fmtUsd(pipelineCap)}, Ask{' '}
          {fmtUsd(askCap)}.
        </p>
        <Table>
          <thead>
            <tr>
              <th className={th}>Day</th>
              {CATEGORIES.map((c) => (
                <th key={c} className={th}>
                  {c}
                </th>
              ))}
              <th className={th}>Pipeline</th>
              <th className={th}>vs pipeline cap</th>
              <th className={th}>Ask</th>
              <th className={th}>vs Ask cap</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const { pipelineUsd, askUsd } = splitSpend(d.byCategory)
              const usage = capUsage(pipelineUsd, pipelineCap)
              const askUsage = capUsage(askUsd, askCap)
              return (
                <tr key={d.day}>
                  <td className={td}>{d.day}</td>
                  {CATEGORIES.map((c) => (
                    <td key={c} className={td}>
                      {d.byCategory[c] ? fmtUsd(d.byCategory[c]) : '-'}
                    </td>
                  ))}
                  <td className={td}>{fmtUsd(pipelineUsd)}</td>
                  <td className={`${td} ${usage.over ? 'text-danger' : ''}`}>
                    {fmtPct(usage.fraction)}
                    {usage.over ? ' over' : ''}
                  </td>
                  <td className={td}>{fmtUsd(askUsd)}</td>
                  <td className={`${td} ${askUsage.over ? 'text-danger' : ''}`}>
                    {fmtPct(askUsage.fraction)}
                    {askUsage.over ? ' over' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Section>
    </div>
  )
}
