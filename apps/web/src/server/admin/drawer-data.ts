import { errorFields, latestGateJudgement, reelScriptSchema } from '@reelset/core'
import type { Database, GateDecisionRow, Logger } from '@reelset/core'
import { toGateView } from '@/lib/admin/gate'
import { suggestRetryStage } from '@/lib/admin/retry-stage'
import type { ItemDrawerData, ScriptView } from '@/lib/admin/drawer-types'
import { mediaUrl } from '@/lib/media'
import { livePostPermalink } from '@/server/admin/instagram'
import { itemDetail, type ItemDetail } from '@/server/admin/pipeline-queries'

type SpendMeta = { provider?: string; model?: string } | null

const iso = (value: Date | string): string => new Date(value).toISOString()

function scriptView(raw: unknown): ScriptView | null {
  const parsed = reelScriptSchema.safeParse(raw)
  if (!parsed.success) return null
  const { hook, beats, outro } = parsed.data
  return { hook, outro, beats: beats.map((b) => ({ text: b.text, visualType: b.visual.type })) }
}

type Context = {
  mediaBase: string
  permalink: string | null
  now: Date
  gate?: GateDecisionRow | null
}

/** Pure projection of the pipeline query onto exactly what the item drawer renders. */
export function toItemDrawerData(detail: ItemDetail, ctx: Context): ItemDrawerData {
  const { item, events, renders, spend } = detail
  const done = renders.find((r) => r.status === 'done' && r.video_key)
  const tts = spend.find((s) => s.category === 'tts')
  const spendRows = spend.map((s) => {
    const meta = s.meta as SpendMeta
    return {
      category: s.category,
      costUsd: Number(s.cost_usd),
      label: meta?.model ?? meta?.provider ?? null,
    }
  })
  return {
    now: ctx.now.toISOString(),
    item: {
      id: item.id,
      title: item.title,
      source: item.source,
      status: item.status,
      attempts: item.attempts,
      firstSeenAt: iso(item.first_seen_at),
      canonicalUrl: item.canonical_url,
      visibility: item.visibility,
      hiddenReason: item.hidden_reason,
      hiddenAt: item.hidden_at ? iso(item.hidden_at) : null,
      lastError: item.last_error,
      lastOkStage: item.last_ok_stage,
      tldr: item.tldr,
    },
    retryStage: suggestRetryStage(item.last_ok_stage),
    script: scriptView(item.script),
    events: events.map((e) => ({
      stage: e.stage,
      outcome: e.outcome,
      attempt: e.attempt,
      duration_ms: e.duration_ms,
      error: e.error,
      created_at: iso(e.created_at),
    })),
    renders: renders.map((r) => ({
      status: r.status,
      attempts: r.attempts,
      templateVersion: r.template_version,
      renderMs: r.render_ms,
      videoDurationMs: r.video_duration_ms,
      bytes: r.bytes,
      hasVideo: Boolean(r.video_key),
    })),
    video: done?.video_key
      ? {
          url: mediaUrl(ctx.mediaBase, done.video_key) ?? '',
          posterUrl: mediaUrl(ctx.mediaBase, done.poster_key),
        }
      : null,
    narrationProvider: (tts?.meta as SpendMeta)?.provider ?? null,
    spend: spendRows,
    totalUsd: spendRows.reduce((sum, s) => sum + s.costUsd, 0),
    postedPermalink: ctx.permalink,
    gate: ctx.gate ? toGateView(ctx.gate) : null,
  }
}

// The drawer must keep working before the gate table exists, so a failed lookup reads as "never judged".
async function gateDecisionOrNull(
  db: Database,
  itemId: string,
  log: Logger,
): Promise<GateDecisionRow | null> {
  try {
    return await latestGateJudgement(db, itemId)
  } catch (err) {
    log.warn({ ...errorFields(err), itemId }, 'gate decision unavailable for the item drawer')
    return null
  }
}

export async function loadItemDrawer(
  db: Database,
  id: string,
  mediaBase: string,
  log: Logger,
): Promise<ItemDrawerData | null> {
  const detail = await itemDetail(db, id)
  if (!detail) return null
  const [permalink, gate] = await Promise.all([
    livePostPermalink(db, id),
    gateDecisionOrNull(db, id, log),
  ])
  return toItemDrawerData(detail, { mediaBase, permalink, now: new Date(), gate })
}
