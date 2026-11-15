'use client'

import Link from 'next/link'
import { fmtBytes, fmtDate, fmtMs, fmtUsd } from '@/lib/admin/format'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { buildTimeline, relativeTime, stepperFor } from '@/lib/admin/pipeline'
import type { ItemDrawerData, ItemPreview } from '@/lib/admin/drawer-types'
import { Block, DrawerError, KV } from '@/components/admin/drawer/blocks'
import type { DetailError } from '@/components/admin/drawer/detail-store'
import { HideControls } from '@/components/admin/moderation/HideControls'
import { VisibilityBadge } from '@/components/admin/moderation/VisibilityBadge'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { ArrowUpRightIcon } from '@/components/ui/icons'
import { useTimeZone } from '@/components/ui/TimeZoneContext'
import { ErrorLine } from './ErrorLine'
import { Gantt } from './Gantt'
import { ItemDrawerSkeleton } from './ItemDrawerSkeleton'
import { QuickRetry } from './QuickRetry'
import { Stepper } from './Stepper'

type Props = {
  preview: ItemPreview | undefined
  data: ItemDrawerData | null
  error: DetailError | null
  returnTo: string
  onRetry: () => void
}

const statusLabel = (status: string) => (status === 'summarized' ? 'scripted' : status)

function Header({ preview, data }: Pick<Props, 'preview' | 'data'>) {
  const item = data?.item
  const title = item?.title ?? preview?.title
  const source = item?.source ?? preview?.source
  const status = item?.status ?? preview?.status
  const now = data ? new Date(data.now) : null
  return (
    <header className="space-y-2">
      <h2 className="text-base font-semibold leading-snug">{title ?? 'Loading item'}</h2>
      <p className="flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {source ? (
          <span className="inline-flex items-center gap-1.5">
            <SourceDot source={source} />
            {sourceMeta(source).label}
          </span>
        ) : null}
        {status ? <span>{statusLabel(status)}</span> : null}
        {item && now ? (
          <>
            <span>attempt {Math.max(item.attempts, data?.renders[0]?.attempts ?? 0, 1)}</span>
            <span>first seen {relativeTime(item.firstSeenAt, now)}</span>
          </>
        ) : null}
      </p>
      {data ? <HeaderLinks data={data} /> : null}
    </header>
  )
}

function HeaderLinks({ data }: { data: ItemDrawerData }) {
  const { item, postedPermalink } = data
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <a
        href={item.canonicalUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-info hover:underline"
      >
        Source <ArrowUpRightIcon className="h-3 w-3" />
      </a>
      {item.status === 'rendered' && item.visibility !== 'hidden' ? (
        <Link
          href={`${ADMIN_ROUTES.instagram}?item=${item.id}`}
          className="text-info hover:underline"
        >
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
  )
}

function Moderation({
  data,
  returnTo,
  tz,
}: {
  data: ItemDrawerData
  returnTo: string
  tz: string
}) {
  const { item } = data
  if (item.visibility === 'private') return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-3">
      <div className="space-y-0.5 text-xs">
        <p className="text-muted">{item.visibility === 'hidden' ? 'Hidden' : 'Public'}</p>
        <VisibilityBadge visibility={item.visibility} reason={item.hiddenReason} />
        {item.hiddenAt ? <p className="text-faint">since {fmtDate(item.hiddenAt, tz)}</p> : null}
      </div>
      <HideControls itemId={item.id} visibility={item.visibility} returnTo={returnTo} />
    </div>
  )
}

function Script({ data }: { data: ItemDrawerData }) {
  const { script, item } = data
  if (!script) return <p className="text-xs text-faint">{item.tldr ?? 'No script yet.'}</p>
  return (
    <ol className="space-y-2 text-xs leading-relaxed">
      <li>
        <span className="text-faint">Hook </span>
        {script.hook}
      </li>
      {script.beats.map((beat, i) => (
        <li key={i}>
          <span className="text-faint">
            Beat {i + 1} · {beat.visualType}{' '}
          </span>
          {beat.text}
        </li>
      ))}
      <li>
        <span className="text-faint">Outro </span>
        {script.outro}
      </li>
    </ol>
  )
}

function Render({ data }: { data: ItemDrawerData }) {
  const latest = data.renders[0]
  if (!latest) return <p className="text-xs text-faint">No render yet.</p>
  const done = data.renders.find((r) => r.status === 'done' && r.hasVideo)
  return (
    <dl className="space-y-1.5">
      <KV k="Status" v={latest.status} />
      <KV k="Template" v={latest.templateVersion ? `v${latest.templateVersion}` : '-'} />
      <KV k="Narration" v={data.narrationProvider ?? '-'} />
      <KV k="Render time" v={fmtMs(latest.renderMs)} />
      <KV k="Video length" v={fmtMs(done?.videoDurationMs)} />
      <KV k="File size" v={fmtBytes(done?.bytes)} />
      <KV k="Attempts" v={latest.attempts} />
    </dl>
  )
}

function Cost({ data }: { data: ItemDrawerData }) {
  if (data.spend.length === 0) return <p className="text-xs text-faint">No spend recorded.</p>
  return (
    <ul className="space-y-1">
      {data.spend.map((s, i) => (
        <li key={i} className="flex justify-between gap-3 text-xs">
          <span className="text-muted">
            {s.category}
            {s.label ? ` · ${s.label}` : ''}
          </span>
          <span className="tabular-nums">{fmtUsd(s.costUsd)}</span>
        </li>
      ))}
    </ul>
  )
}

function Body({ data, returnTo }: { data: ItemDrawerData; returnTo: string }) {
  const tz = useTimeZone()
  const { item, video } = data
  return (
    <>
      <Moderation data={data} returnTo={returnTo} tz={tz} />
      <Stepper steps={stepperFor(item.status, item.lastOkStage)} />
      {item.lastError ? (
        <div className="space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3">
          <ErrorLine raw={item.lastError} />
          {item.status === 'failed' ? (
            <QuickRetry itemId={item.id} lastOkStage={item.lastOkStage} returnTo={returnTo} />
          ) : null}
        </div>
      ) : null}
      {video ? (
        <video
          controls
          playsInline
          preload="metadata"
          poster={video.posterUrl ?? undefined}
          src={video.url}
          className="mx-auto aspect-[9/16] max-h-[56vh] rounded-md border border-line bg-black"
        />
      ) : null}
      <Block title="Timeline">
        <Gantt timeline={buildTimeline(data.events)} />
      </Block>
      <Block title="Script">
        <Script data={data} />
      </Block>
      <Block title="Render">
        <Render data={data} />
      </Block>
      <Block title={`Cost · ${fmtUsd(data.totalUsd)}`}>
        <Cost data={data} />
      </Block>
      <p className="break-all pt-2 font-mono text-[11px] text-faint">{item.id}</p>
    </>
  )
}

/** Item details: header from the clicked row at once, body skeleton until the API answers. */
export function ItemDrawer({ preview, data, error, returnTo, onRetry }: Props) {
  return (
    <div className="space-y-5 text-[13px]">
      <Header preview={preview} data={data} />
      {data ? (
        <Body data={data} returnTo={returnTo} />
      ) : error ? (
        <DrawerError status={error.status} onRetry={onRetry} />
      ) : (
        <ItemDrawerSkeleton status={preview?.status} />
      )}
    </div>
  )
}
