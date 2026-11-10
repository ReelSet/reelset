import { fmtPct, fmtUsd } from '@/lib/admin/format'
import type { HealthSnapshot } from '@/server/admin/pipeline-queries'
import { Ago } from './Elapsed'

const CATEGORY_COLOR: Record<string, string> = {
  llm: 'bg-info',
  embedding: 'bg-src-github',
  tts: 'bg-warn',
  render: 'bg-ok',
}

function Tile({
  label,
  children,
  tone,
}: {
  label: string
  children: React.ReactNode
  tone?: 'warn' | 'danger'
}) {
  const ring =
    tone === 'danger' ? 'border-danger/40' : tone === 'warn' ? 'border-warn/40' : 'border-line'
  return (
    <div className={`min-w-0 rounded-md border bg-surface px-3.5 py-3 ${ring}`}>
      <p className="text-[11px] text-faint">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function Meter({
  parts,
  total,
}: {
  parts: { key: string; value: number; color: string }[]
  total: number
}) {
  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-raised" role="presentation">
      {parts.map((p) => (
        <span
          key={p.key}
          className={p.color}
          style={{ width: `${Math.min(100, (p.value / total) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function HealthStrip({ health, now }: { health: HealthSnapshot; now: Date }) {
  const spent = health.spend.reduce((sum, s) => sum + s.usd, 0)
  const queue = new Map(health.queue.map((q) => [q.status, q.count]))
  const rateTone =
    health.failureLastHour.rate !== null && health.failureLastHour.rate > 0.2 ? 'danger' : undefined
  const resumeAt = health.pause ? new Date(health.pause.until) : null
  return (
    <section aria-label="Pipeline health" className="mb-7 space-y-3">
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3.5 py-2.5 ${
          health.pause ? 'border-warn/40 bg-warn/5' : 'border-line bg-surface'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${health.pause ? 'bg-warn' : 'bg-ok'}`} />
        <p className="font-medium">{health.pause ? 'Pipeline paused' : 'Pipeline running'}</p>
        {health.pause ? (
          <p className="min-w-0 text-muted">
            {health.pause.reason}
            {resumeAt ? (
              <>
                {' '}
                · next check{' '}
                {resumeAt > now
                  ? 'in ' +
                    Math.max(1, Math.round((resumeAt.getTime() - now.getTime()) / 60000)) +
                    ' min'
                  : 'now'}
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-muted">Ingest and render are accepting work</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Spend today"
          tone={
            spent >= health.spendCapUsd
              ? 'danger'
              : spent >= health.spendCapUsd * 0.8
                ? 'warn'
                : undefined
          }
        >
          <p className="tabular-nums">
            <span className="text-lg font-semibold">{fmtUsd(spent)}</span>
            <span className="text-faint"> / ${health.spendCapUsd}</span>
          </p>
          <Meter
            total={health.spendCapUsd}
            parts={health.spend.map((s) => ({
              key: s.category,
              value: s.usd,
              color: CATEGORY_COLOR[s.category] ?? 'bg-muted',
            }))}
          />
          <p className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-faint">
            {health.spend.map((s) => (
              <span key={s.category} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_COLOR[s.category]}`} />
                {s.category} {fmtUsd(s.usd)}
              </span>
            ))}
          </p>
        </Tile>
        <Tile
          label="Reels admitted today"
          tone={health.admittedToday >= health.dailyCap ? 'warn' : undefined}
        >
          <p className="tabular-nums">
            <span className="text-lg font-semibold">{health.admittedToday}</span>
            <span className="text-faint"> / {health.dailyCap}</span>
          </p>
          <Meter
            total={health.dailyCap}
            parts={[{ key: 'a', value: health.admittedToday, color: 'bg-accent' }]}
          />
        </Tile>
        <Tile label="Queue depth">
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
            {(['found', 'summarized', 'embedded', 'voiced'] as const).map((s) => (
              <span key={s}>
                <span className="font-semibold">{queue.get(s) ?? 0}</span>{' '}
                <span className="text-[11px] text-faint">
                  {s === 'summarized' ? 'scripted' : s}
                </span>
              </span>
            ))}
          </p>
        </Tile>
        <Tile label="Rendering now">
          <p className="tabular-nums">
            <span className="text-lg font-semibold">{health.rendering}</span>
            <span className="text-faint"> active · {health.renderQueued} waiting</span>
          </p>
        </Tile>
        <Tile label="Render failures, last hour" tone={rateTone}>
          <p className="tabular-nums">
            <span className="text-lg font-semibold">{fmtPct(health.failureLastHour.rate)}</span>
            <span className="text-faint">
              {' '}
              {health.failureLastHour.failed}/{health.failureLastHour.total}
            </span>
          </p>
        </Tile>
        <Tile label="Last render finished">
          <p className="text-lg font-semibold">
            <Ago at={health.lastRenderAt} />
          </p>
        </Tile>
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
        <span>Template v{health.templateVersion ?? '?'}</span>
        <span>
          Scripts:{' '}
          {health.llm
            ? `${health.llm.provider ?? '?'} / ${health.llm.model ?? '?'}`
            : 'no data yet'}
        </span>
        <span>
          Voice: {health.tts.provider}
          {health.tts.speaker ? ` (${health.tts.speaker})` : ''}
        </span>
      </p>
    </section>
  )
}
