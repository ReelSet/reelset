import { fmtDate, fmtPct, truncate } from '@/lib/admin/format'
import { PageTitle, Empty, Section, Table, td, th } from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import {
  renderFailureLastHour,
  sourceHealth,
  transcriptHealth,
  ttsFailureRecent,
  TTS_WINDOW_HOURS,
  youtubeDiscovery,
} from '@/server/admin/queries'
import { getDb } from '@/server/db'

export default async function HealthPage() {
  await assertAdmin()
  const db = getDb()
  const [health, youtube, transcripts, renders, tts] = await Promise.all([
    sourceHealth(db),
    youtubeDiscovery(db),
    transcriptHealth(db),
    renderFailureLastHour(db),
    ttsFailureRecent(db),
  ])

  return (
    <div>
      <PageTitle title="Source health" />
      <Section title="Signals">
        <Table>
          <thead>
            <tr>
              <th className={th}>YouTube discovery</th>
              <th className={th}>Transcript success (last {transcripts.attempts})</th>
              <th className={th}>Render failures, last hour</th>
              <th className={th}>edge-tts failures, last {TTS_WINDOW_HOURS}h</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>
                {youtube.status
                  ? `${youtube.status}, ${fmtDate(youtube.at)}, fetched ${youtube.fetched}`
                  : 'no youtube task yet'}
                <div className="text-xs text-faint">
                  youtube_search_failing alert last sent: {fmtDate(youtube.alertLastSentAt)}
                </div>
                {youtube.error ? (
                  <div className="text-xs text-danger">{truncate(youtube.error, 160)}</div>
                ) : null}
              </td>
              <td className={td}>
                {fmtPct(transcripts.rate)}
                {transcripts.enoughData ? '' : ' (too few attempts to alert on)'}
              </td>
              <td className={td}>
                {renders.failed} / {renders.total} ({fmtPct(renders.rate)})
              </td>
              <td className={td}>
                {tts.failed} / {tts.total} ({fmtPct(tts.rate)})
              </td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Sources (tasks in the last 24 hours)">
        {health.sources.length === 0 ? (
          <Empty>No ingest tasks in the last 24 hours</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Source</th>
                <th className={th}>Last ok task (UTC)</th>
                <th className={th}>Last failed task</th>
                <th className={th}>Tasks</th>
                <th className={th}>Last error</th>
              </tr>
            </thead>
            <tbody>
              {health.sources.map((s) => (
                <tr key={s.source}>
                  <td className={td}>{s.source}</td>
                  <td className={td}>{fmtDate(s.lastOkAt)}</td>
                  <td className={td}>{fmtDate(s.lastFailedAt)}</td>
                  <td className={td}>{s.tasks24h}</td>
                  <td className={`${td} text-danger`}>{truncate(s.lastError, 200)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Source watermarks">
        {health.watermarks.length === 0 ? (
          <Empty>No watermarks yet</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Source</th>
                <th className={th}>Scope</th>
                <th className={th}>Lane</th>
                <th className={th}>Newest</th>
                <th className={th}>Oldest</th>
                <th className={th}>Backfill done</th>
                <th className={th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {health.watermarks.map((w) => (
                <tr key={`${w.source}:${w.scope}:${w.lane}`}>
                  <td className={td}>{w.source}</td>
                  <td className={td}>{truncate(w.scope, 40)}</td>
                  <td className={td}>{w.lane}</td>
                  <td className={td}>{fmtDate(w.newest_at)}</td>
                  <td className={td}>{fmtDate(w.oldest_at)}</td>
                  <td className={td}>{w.backfill_complete ? 'yes' : 'no'}</td>
                  <td className={td}>{fmtDate(w.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  )
}
