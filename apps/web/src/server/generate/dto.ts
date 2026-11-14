import { requestSteps, type ReelRequestRow } from '@reelset/core'
import {
  reelDownloadUrl,
  type CreditsDto,
  type GeneratedReel,
  type ReelRequestDto,
} from '@/lib/generate/types'
import { mediaUrl } from '@/lib/media'
import { reelPath } from '@/lib/reel-url'
import { absoluteUrl } from '@/lib/seo/site'

export type RequestItemInfo = {
  id: string
  title: string
  status: string
  visibility: string
}
export type RequestRenderInfo = {
  status: string
  video_key: string | null
  poster_key: string | null
  video_duration_ms: number | null
  finished_at: Date | null
}
export type RequestEventInfo = { stage: string; outcome: string; createdAt: Date }
export type RequestContext = {
  item: RequestItemInfo | null
  render: RequestRenderInfo | null
  events: RequestEventInfo[]
  aheadOfYou: number | null
}

/** Picks the finished render the feed would serve, else the newest render. */
export function pickRender<
  T extends RequestRenderInfo & { template_version?: number | null; created_at?: Date },
>(renders: readonly T[]): T | null {
  const time = (d: Date | null | undefined) => (d ? d.getTime() : 0)
  const done = renders
    .filter((r) => r.status === 'done' && r.video_key)
    .sort(
      (a, b) =>
        (b.template_version ?? 0) - (a.template_version ?? 0) ||
        time(b.finished_at) - time(a.finished_at) ||
        time(b.created_at) - time(a.created_at),
    )
  if (done[0]) return done[0]
  return [...renders].sort((a, b) => time(b.created_at) - time(a.created_at))[0] ?? null
}

export function buildReel(
  ctx: RequestContext,
  itemId: string | null,
  mediaBase: string,
): GeneratedReel | null {
  if (!itemId || !ctx.item) return null
  const done = ctx.render?.status === 'done' && ctx.item.status === 'rendered'
  return {
    itemId,
    title: ctx.item.title || null,
    pageUrl: absoluteUrl(reelPath({ id: itemId, title: ctx.item.title })),
    videoUrl: done ? mediaUrl(mediaBase, ctx.render?.video_key ?? null) : null,
    downloadUrl: done ? reelDownloadUrl(ctx.render?.video_key ?? null, ctx.item.title) : null,
    posterUrl: done ? mediaUrl(mediaBase, ctx.render?.poster_key ?? null) : null,
    durationMs: done ? (ctx.render?.video_duration_ms ?? null) : null,
    visibility: ctx.item.visibility === 'private' ? 'private' : 'public',
  }
}

export function buildReelRequestDto(
  row: ReelRequestRow,
  ctx: RequestContext,
  mediaBase: string,
): ReelRequestDto {
  const status = row.status as ReelRequestDto['status']
  const steps = requestSteps({
    requestStatus: status,
    requestCreatedAt: row.created_at,
    itemStatus: ctx.item?.status ?? null,
    renderStatus: ctx.render?.status ?? null,
    renderFinishedAt: ctx.render?.finished_at ?? null,
    events: ctx.events,
  })
  const rendering = ctx.item?.status === 'voiced' || ctx.render?.status === 'rendering'
  return {
    id: row.id,
    urls: row.urls,
    status,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    via: row.via as ReelRequestDto['via'],
    creditsCharged: row.credits_charged,
    steps,
    aheadOfYou: status === 'done' || status === 'failed' || rendering ? null : ctx.aheadOfYou,
    reel: buildReel(ctx, row.item_id, mediaBase),
  }
}

export type CreditsInput = {
  monthlyFree: number
  cost: number
  balance: number
  resetsAt: Date
  unlimited: boolean
}

export function buildCreditsDto(input: CreditsInput): CreditsDto {
  const balance = input.unlimited ? input.monthlyFree : Math.max(0, input.balance)
  return {
    balance,
    monthlyFree: input.monthlyFree,
    cost: input.cost,
    resetsAt: input.resetsAt.toISOString(),
    unlimited: input.unlimited,
    reelsLeft: input.unlimited
      ? Math.floor(input.monthlyFree / input.cost)
      : Math.floor(balance / input.cost),
  }
}
