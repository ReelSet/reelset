import Link from 'next/link'
import { Empty, Table, td, th } from '@/components/admin/ui'
import { fmtDate, fmtMs, fmtUsd, truncate } from '@/lib/admin/format'
import { directorRunCostUsd, fmtTokens } from '@/lib/admin/director'
import type { DirectorRun } from '@/server/admin/director'

function Outcome({ run }: { run: DirectorRun }) {
  const { used, fallbackReason } = run.director
  if (used) return <span className="text-ok">used</span>
  return <span className="text-warn">fallback{fallbackReason ? ` (${fallbackReason})` : ''}</span>
}

function Row({ run }: { run: DirectorRun }) {
  const d = run.director
  const cost = directorRunCostUsd(d)
  const tokens = d.inputTokens + d.cacheReadTokens + d.cacheWriteTokens
  return (
    <tr>
      <td className={td}>
        <Link href={`/admin?item=${run.itemId}`}>{truncate(run.title, 50)}</Link>
      </td>
      <td className={`${td} whitespace-nowrap`}>{fmtDate(run.at)}</td>
      <td className={td}>
        <Outcome run={run} />
      </td>
      <td className={`${td} tabular-nums`}>{d.scenes}</td>
      <td className={`${td} tabular-nums ${d.sceneErrors > 0 ? 'text-danger' : ''}`}>
        {d.sceneErrors}
      </td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>
        {fmtTokens(tokens)} in / {fmtTokens(d.outputTokens)} out
      </td>
      <td className={`${td} tabular-nums`}>{cost === null ? '-' : fmtUsd(cost)}</td>
      <td className={`${td} tabular-nums`}>{fmtMs(d.ms)}</td>
      <td className={`${td} tabular-nums`}>
        {run.renderMs === null ? '-' : `${(run.renderMs / 60_000).toFixed(1)} min`}
      </td>
    </tr>
  )
}

export function RecentRuns({ runs }: { runs: DirectorRun[] }) {
  if (runs.length === 0) return <Empty>No renders have reported a director run yet</Empty>
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Item</th>
          <th className={th}>When (UTC)</th>
          <th className={th}>Result</th>
          <th className={th}>Scenes</th>
          <th className={th}>Scene errors</th>
          <th className={th}>Tokens</th>
          <th className={th}>Cost</th>
          <th className={th}>Director time</th>
          <th className={th}>Render time</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <Row key={run.renderId} run={run} />
        ))}
      </tbody>
    </Table>
  )
}
