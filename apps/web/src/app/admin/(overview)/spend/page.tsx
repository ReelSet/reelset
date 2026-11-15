import { SETTINGS, SpendCategory, getSetting } from '@reelset/core'
import { fmtPct, fmtUsd } from '@/lib/admin/format'
import { capUsage, splitSpend } from '@/lib/admin/spend'
import { ChartCard } from '@/components/admin/charts/ChartCard'
import { ComparisonBarChart } from '@/components/admin/charts/ComparisonBarChart'
import { CHART_COLORS } from '@/components/admin/charts/theme'
import { Section, Stat, Table, Toolbar, td, th } from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import { viewerTimeZone } from '@/server/timezone'
import { utcDayResetHint } from '@/lib/time/zone'
import { spendLedger } from '@/server/admin/queries'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

const CATEGORIES = Object.values(SpendCategory)
const COLORS: Record<string, string> = {
  llm: CHART_COLORS.accent,
  embedding: CHART_COLORS.info,
  tts: CHART_COLORS.warn,
  render: CHART_COLORS.violet,
  ask: CHART_COLORS.orange,
}
const SERIES = CATEGORIES.map((c) => ({
  key: c,
  label: c,
  color: COLORS[c] ?? CHART_COLORS.faint,
}))

export default async function SpendPage() {
  await assertAdmin()
  const tz = await viewerTimeZone()
  const db = getDb()
  const log = routeLog('admin/spend')
  const [days, pipelineCap, askCap] = await Promise.all([
    spendLedger(db),
    getSetting(db, SETTINGS.pipelineDailySpendCapUsd, log),
    getSetting(db, SETTINGS.askDailySpendCapUsd, log),
  ])

  const chartData = [...days].reverse().map((d) => ({ day: d.day, ...d.byCategory }))
  const today = days[0]
  const todaySplit = today ? splitSpend(today.byCategory) : { pipelineUsd: 0, askUsd: 0 }

  return (
    <div>
      <Toolbar hint={`Daily cost by category. ${utcDayResetHint(tz)}`} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pipeline today" value={fmtUsd(todaySplit.pipelineUsd)} />
        <Stat label="Pipeline cap" value={fmtUsd(pipelineCap)} />
        <Stat label="Ask today" value={fmtUsd(todaySplit.askUsd)} />
        <Stat label="Ask cap" value={fmtUsd(askCap)} />
      </div>
      <div className="mb-9">
        <ChartCard title="Last 14 days" legend={SERIES}>
          <ComparisonBarChart data={chartData} series={SERIES} unit="usd" stacked />
        </ChartCard>
      </div>
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
