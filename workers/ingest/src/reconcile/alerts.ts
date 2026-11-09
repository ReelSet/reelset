import { sql } from 'kysely'
import {
  SETTINGS,
  errorFields,
  getSetting,
  sendAlert,
  spendTodayUsd,
  type AlertInput,
  type Database,
  type Logger,
  type Source,
} from '@reelset/core'
import {
  ALERT_NO_RENDER_MS,
  ALERT_SOURCE_LAG_MS,
  SPEND_CATEGORIES_FOR_CAP,
  TRANSCRIPT_MIN_ATTEMPTS,
  TRANSCRIPT_MIN_SUCCESS,
  TRANSCRIPT_WINDOW,
  YOUTUBE_FAILING_RUNS,
} from '../config'

export type AlertSnapshot = {
  now: Date
  lastRenderedAt: Date | null
  firstItemAt: Date | null
  sourceLastOk: Partial<Record<Source, Date | null>>
  /** Statuses of the most recent settled youtube ingest tasks, newest first. */
  youtubeTaskStatuses: string[]
  spendTodayUsd: number
  spendCapUsd: number
  transcriptResults: boolean[]
}

export function evaluateAlerts(s: AlertSnapshot): AlertInput[] {
  const alerts: AlertInput[] = []
  const now = s.now.getTime()

  const renderReference = s.lastRenderedAt ?? s.firstItemAt
  if (renderReference && now - renderReference.getTime() > ALERT_NO_RENDER_MS) {
    const hours = Math.round(((now - renderReference.getTime()) / 3_600_000) * 10) / 10
    alerts.push({
      key: 'no_item_rendered_3h',
      message: 'No item has been rendered in over 3 hours',
      fields: { hoursSince: hours, everRendered: s.lastRenderedAt !== null },
    })
  }

  for (const [source, lastOk] of Object.entries(s.sourceLastOk)) {
    if (!lastOk) continue
    if (now - lastOk.getTime() > ALERT_SOURCE_LAG_MS) {
      alerts.push({
        key: 'source_lag',
        message: `Source ${source} has had no successful ingest task for over 2 hours`,
        fields: { source, lastOkAt: lastOk.toISOString() },
      })
    }
  }

  const recentYoutube = s.youtubeTaskStatuses.slice(0, YOUTUBE_FAILING_RUNS)
  if (
    recentYoutube.length >= YOUTUBE_FAILING_RUNS &&
    recentYoutube.every((status) => status === 'failed')
  ) {
    alerts.push({
      key: 'youtube_search_failing',
      message: `YouTube search failed in each of the last ${YOUTUBE_FAILING_RUNS} ingest runs`,
      fields: { runs: recentYoutube.length },
    })
  }

  if (s.spendTodayUsd >= s.spendCapUsd) {
    alerts.push({
      key: 'spend_cap_reached',
      message: 'Pipeline daily spend cap reached, admission paused',
      fields: { spentUsd: Math.round(s.spendTodayUsd * 100) / 100, capUsd: s.spendCapUsd },
    })
  }

  const attempts = s.transcriptResults.slice(0, TRANSCRIPT_WINDOW)
  if (attempts.length >= TRANSCRIPT_MIN_ATTEMPTS) {
    const rate = attempts.filter(Boolean).length / attempts.length
    if (rate < TRANSCRIPT_MIN_SUCCESS) {
      alerts.push({
        key: 'transcript_success_low',
        message: 'YouTube transcript success rate is below 50%',
        fields: { successPercent: Math.round(rate * 100), attempts: attempts.length },
      })
    }
  }

  return alerts
}

async function gatherSnapshot(db: Database, log: Logger, now: Date): Promise<AlertSnapshot> {
  const rendered = await db
    .selectFrom('item')
    .select(sql<Date | null>`max(rendered_at)`.as('last'))
    .executeTakeFirst()
  const first = await db
    .selectFrom('item')
    .select(sql<Date | null>`min(first_seen_at)`.as('first'))
    .executeTakeFirst()
  const sources = await db
    .selectFrom('ingest_task')
    .select([
      'source',
      sql<Date | null>`coalesce(max(finished_at) filter (where status in ('ok','empty')), min(started_at))`.as(
        'last_ok',
      ),
    ])
    .groupBy('source')
    .execute()

  const transcriptRows = await sql<{ stage: string }>`
    select e.stage
    from item_event e
    join item i on i.id = e.item_id
    where i.canonical_key like 'youtube:%'
      and e.stage in ('summarized', 'insufficient_source')
      and e.outcome = 'ok'
    order by e.created_at desc
    limit ${TRANSCRIPT_WINDOW}`.execute(db)

  const youtubeTasks = await db
    .selectFrom('ingest_task')
    .select('status')
    .where('source', '=', 'youtube')
    .where('status', 'in', ['ok', 'empty', 'failed', 'deferred'])
    .orderBy('started_at', 'desc')
    .limit(YOUTUBE_FAILING_RUNS)
    .execute()
  const spendCapUsd = await getSetting(db, SETTINGS.pipelineDailySpendCapUsd, log)

  return {
    now,
    lastRenderedAt: rendered?.last ? new Date(rendered.last) : null,
    firstItemAt: first?.first ? new Date(first.first) : null,
    sourceLastOk: Object.fromEntries(
      sources.map((r) => [r.source, r.last_ok ? new Date(r.last_ok) : null]),
    ),
    youtubeTaskStatuses: youtubeTasks.map((t) => t.status),
    spendTodayUsd: await spendTodayUsd(db, SPEND_CATEGORIES_FOR_CAP),
    spendCapUsd,
    transcriptResults: transcriptRows.rows.map((r) => r.stage === 'summarized'),
  }
}

export async function runAlerts(
  db: Database,
  webhookUrl: string | undefined,
  log: Logger,
  now = new Date(),
): Promise<AlertInput[]> {
  const l = log.child({ mod: 'alerts' })
  const snapshot = await gatherSnapshot(db, l, now)
  const alerts = evaluateAlerts(snapshot)
  for (const alert of alerts) {
    try {
      await sendAlert(db, webhookUrl, alert, l)
    } catch (err) {
      l.error({ alert: alert.key, ...errorFields(err) }, 'alert delivery failed')
    }
  }
  l.debug({ fired: alerts.length }, 'alerts evaluated')
  return alerts
}
