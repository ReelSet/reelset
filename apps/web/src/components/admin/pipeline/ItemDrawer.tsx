import Link from 'next/link'
import { reelScriptSchema } from '@reelset/core'
import { fmtBytes, fmtMs, fmtUsd } from '@/lib/admin/format'
import { buildTimeline, stepperFor, relativeTime } from '@/lib/admin/pipeline'
import { mediaUrl } from '@/lib/media'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { ArrowUpRightIcon } from '@/components/ui/icons'
import type { ItemDetail } from '@/server/admin/pipeline-queries'
import { DrawerShell } from './DrawerShell'
import { ErrorLine } from './ErrorLine'
import { Gantt } from './Gantt'
import { QuickRetry } from './QuickRetry'
import { Stepper } from './Stepper'

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        {title}
      </h3>
      {children}
    </section>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <dt className="text-faint">{k}</dt>
      <dd className="min-w-0 truncate text-right tabular-nums">{v}</dd>
    </div>
  )
}

export function ItemDrawer({
  detail,
  closeHref,
  returnTo,
  mediaBase,
  instagramHref,
  postedPermalink,
  now,
}: {
  detail: ItemDetail
  closeHref: string
  returnTo: string
  mediaBase: string
  instagramHref: string
  postedPermalink: string | null
  now: Date
}) {
  const { item, events, renders, spend } = detail
  const done = renders.find((r) => r.status === 'done' && r.video_key)
  const latest = renders[0]
  const timeline = buildTimeline(events)
  const script = reelScriptSchema.safeParse(item.script)
  const ttsRow = spend.find((s) => s.category === 'tts')
  const ttsProvider = (ttsRow?.meta as { provider?: string } | null)?.provider ?? null
  const totalUsd = spend.reduce((sum, s) => sum + Number(s.cost_usd), 0)

  return (
    <DrawerShell closeHref={closeHref} title={item.title}>
      <div className="space-y-5 text-[13px]">
        <header className="space-y-2">
          <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <SourceDot source={item.source} />
              {sourceMeta(item.source).label}
            </span>
            <span>{item.status === 'summarized' ? 'scripted' : item.status}</span>
            <span>attempt {Math.max(item.attempts, latest?.attempts ?? 0, 1)}</span>
            <span>first seen {relativeTime(item.first_seen_at, now)}</span>
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <a
              href={item.canonical_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-info hover:underline"
            >
              Source <ArrowUpRightIcon className="h-3 w-3" />
            </a>
            {item.status === 'rendered' ? (
              <Link href={instagramHref} className="text-info hover:underline">
                {postedPermalink ? 'Posted to Instagram' : 'Post to Instagram'}
              </Link>
            ) : null}
            {postedPermalink ? (
              <a
                href={postedPermalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-info hover:underline"
              >
                Open post <ArrowUpRightIcon className="h-3 w-3" />
              </a>
            ) : null}
          </p>
        </header>

        <Stepper steps={stepperFor(item.status, item.last_ok_stage)} />

        {item.last_error ? (
          <div className="space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3">
            <ErrorLine raw={item.last_error} />
            {item.status === 'failed' ? (
              <QuickRetry itemId={item.id} lastOkStage={item.last_ok_stage} returnTo={returnTo} />
            ) : null}
          </div>
        ) : null}

        {done?.video_key ? (
          <video
            controls
            playsInline
            preload="metadata"
            poster={mediaUrl(mediaBase, done.poster_key) ?? undefined}
            src={mediaUrl(mediaBase, done.video_key) ?? undefined}
            className="mx-auto aspect-[9/16] max-h-[56vh] rounded-md border border-line bg-black"
          />
        ) : null}

        <Block title="Timeline">
          <Gantt timeline={timeline} />
        </Block>

        <Block title="Script">
          {script.success ? (
            <ol className="space-y-2 text-xs leading-relaxed">
              <li>
                <span className="text-faint">Hook </span>
                {script.data.hook}
              </li>
              {script.data.beats.map((beat, i) => (
                <li key={i}>
                  <span className="text-faint">
                    Beat {i + 1} · {beat.visual.type}{' '}
                  </span>
                  {beat.text}
                </li>
              ))}
              <li>
                <span className="text-faint">Outro </span>
                {script.data.outro}
              </li>
            </ol>
          ) : (
            <p className="text-xs text-faint">{item.tldr ?? 'No script yet.'}</p>
          )}
        </Block>

        <Block title="Render">
          {renders.length === 0 ? (
            <p className="text-xs text-faint">No render yet.</p>
          ) : (
            <dl className="space-y-1.5">
              <KV k="Status" v={latest?.status} />
              <KV k="Template" v={latest?.template_version ? `v${latest.template_version}` : '-'} />
              <KV k="Narration" v={ttsProvider ?? '-'} />
              <KV k="Render time" v={fmtMs(latest?.render_ms)} />
              <KV k="Video length" v={fmtMs(done?.video_duration_ms)} />
              <KV k="File size" v={fmtBytes(done?.bytes)} />
              <KV k="Attempts" v={latest?.attempts ?? 0} />
            </dl>
          )}
        </Block>

        <Block title={`Cost · ${fmtUsd(totalUsd)}`}>
          {spend.length === 0 ? (
            <p className="text-xs text-faint">No spend recorded.</p>
          ) : (
            <ul className="space-y-1">
              {spend.map((s, i) => (
                <li key={i} className="flex justify-between gap-3 text-xs">
                  <span className="text-muted">
                    {s.category}
                    {(s.meta as { provider?: string; model?: string } | null)?.model
                      ? ` · ${(s.meta as { model?: string }).model}`
                      : (s.meta as { provider?: string } | null)?.provider
                        ? ` · ${(s.meta as { provider?: string }).provider}`
                        : ''}
                  </span>
                  <span className="tabular-nums">{fmtUsd(Number(s.cost_usd))}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <p className="break-all pt-2 font-mono text-[11px] text-faint">{item.id}</p>
      </div>
    </DrawerShell>
  )
}
