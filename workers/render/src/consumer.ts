import { z } from 'zod'
import {
  StaleTransitionError,
  errorFields,
  reelScriptSchema,
  renderKey as computeRenderKey,
  type ItemStatus,
  type Logger,
  type ReelScript,
  type SpendInput,
  type TransitionInput,
} from '@reelset/core'
import { renderWithFailover, type ContainerFetcher, type RenderMetadata } from './container-client'
import { MAX_VIDEO_BYTES, TEMPLATE_VERSION } from './constants'
import { RenderJobError } from './errors'
import { containerJobId, posterKeyFor, videoKeyFor } from './keys'
import {
  classifyFailure,
  collectImageUrls,
  decideRenderAction,
  renderCostUsd,
  sourceImageUrls,
  type FailureDecision,
} from './plan'
import type { ItemForRender, RenderStore } from './store'

export const jobMessageSchema = z.object({
  itemId: z.uuid(),
  attempt: z.number().int().nonnegative().optional(),
})

export type JobResult =
  { action: 'ack' } | { action: 'retry'; delaySeconds: number } | { action: 'dead_letter' }

export type ConsumerDeps = {
  store: RenderStore
  containers: readonly ContainerFetcher[]
  media: Pick<R2Bucket, 'put'>
  transition: (input: TransitionInput) => Promise<void>
  spend: (input: SpendInput) => Promise<void>
  voice: string
  log: Logger
  now?: () => number
}

type Progress = { status: ItemStatus; renderKey: string | null }

export async function processRenderJob(
  deps: ConsumerDeps,
  body: unknown,
  deliveryAttempts: number,
): Promise<JobResult> {
  const parsed = jobMessageSchema.safeParse(body)
  if (!parsed.success) {
    deps.log.error({ issues: parsed.error.issues.length }, 'invalid render-jobs message, dropping')
    return { action: 'ack' }
  }
  const { itemId } = parsed.data
  const log = deps.log.child({ itemId, deliveryAttempts })
  log.info('render job started')

  const progress: Progress = { status: 'embedded', renderKey: null }
  let item: ItemForRender | null = null
  try {
    item = await deps.store.loadItem(itemId)
    if (!item) {
      log.warn('item not found, acking')
      return { action: 'ack' }
    }
    progress.status = item.status
    return await runJob(deps, item, progress, deliveryAttempts, log)
  } catch (err) {
    if (err instanceof StaleTransitionError) {
      log.warn('stale transition, another delivery advanced the item; acking')
      return { action: 'ack' }
    }
    const decision = classifyFailure(err, deliveryAttempts)
    log.error(
      { ...errorFields(err), code: decision.code, terminal: decision.terminal },
      'render job failed',
    )
    return handleFailure(deps, itemId, progress, deliveryAttempts, decision, log)
  }
}

async function runJob(
  deps: ConsumerDeps,
  item: ItemForRender,
  progress: Progress,
  deliveryAttempts: number,
  log: Logger,
): Promise<JobResult> {
  const early = decideRenderAction(item.status, null)
  if (early.kind === 'skip') {
    log.info({ reason: early.reason }, 'item not renderable, acking')
    return { action: 'ack' }
  }

  if (!item.contentHash || !item.promptVersion) {
    throw new RenderJobError('script_invalid', 'item has no content_hash/prompt_version')
  }
  const script = reelScriptSchema.safeParse(item.script)
  if (!script.success) throw new RenderJobError('script_invalid', 'item script failed validation')

  const key = await computeRenderKey({
    itemId: item.id,
    contentHash: item.contentHash,
    promptVersion: item.promptVersion,
    templateVersion: TEMPLATE_VERSION,
    voice: deps.voice,
  })
  progress.renderKey = key
  const rlog = log.child({ renderKey: key })

  const existing = await deps.store.ensureRender(item.id, key)
  const action = decideRenderAction(item.status, existing)
  rlog.info({ action: action.kind, renderStatus: existing.status }, 'render decision')
  if (action.kind === 'skip') return { action: 'ack' }
  if (action.kind === 'finish') {
    await finishItem(deps, item.id, progress, { resumed: true }, rlog)
    return { action: 'ack' }
  }

  await deps.store.markRendering(key)
  const metadata = await renderAndUpload(deps, item, script.data, key, rlog)
  await recordSpend(deps, metadata, key, rlog)
  await finishItem(
    deps,
    item.id,
    progress,
    { ttsChars: metadata.ttsChars, ttsDurationMs: metadata.ttsDurationMs },
    rlog,
    deliveryAttempts,
  )
  rlog.info({ durationMs: metadata.durationMs, bytes: metadata.bytes }, 'render job done')
  return { action: 'ack' }
}

async function renderAndUpload(
  deps: ConsumerDeps,
  item: ItemForRender,
  script: ReelScript,
  key: string,
  log: Logger,
): Promise<RenderMetadata> {
  const jobId = containerJobId(key)
  const { client, metadata } = await renderWithFailover(
    deps.containers,
    {
      jobId,
      script,
      title: item.title,
      sourceLabel: item.sourceLabel,
      imageUrls: collectImageUrls(script),
      voice: deps.voice,
      source: item.source,
      canonicalUrl: item.canonicalUrl,
      sourceImageUrls: sourceImageUrls(item.source, [item.canonicalUrl, item.mentionUrl]),
    },
    log,
  )
  try {
    if (metadata.bytes > MAX_VIDEO_BYTES) throw new RenderJobError('too_large', 'video over 25 MB')

    const video = await client.download(jobId, 'video')
    const poster = await client.download(jobId, 'poster')
    if (video.byteLength !== metadata.bytes) {
      throw new RenderJobError('bad_container_response', 'video size does not match metadata')
    }

    const videoKey = videoKeyFor(item.id, key)
    const posterKey = posterKeyFor(item.id, key)
    const customMetadata = { itemId: item.id, renderKey: key }
    try {
      await deps.media.put(videoKey, video, {
        httpMetadata: { contentType: 'video/mp4' },
        customMetadata,
      })
      await deps.media.put(posterKey, poster, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata,
      })
    } catch (err) {
      log.error({ videoKey, ...errorFields(err) }, 'r2 upload failed')
      throw new RenderJobError('upload_failed', 'r2 put failed')
    }
    log.info({ videoKey, posterKey, bytes: video.byteLength }, 'uploaded to r2')

    await deps.store.markDone(key, {
      videoKey,
      posterKey,
      bytes: video.byteLength,
      videoDurationMs: metadata.durationMs,
      renderMs: metadata.renderMs,
    })
    return metadata
  } finally {
    await client.remove(jobId)
  }
}

async function recordSpend(
  deps: ConsumerDeps,
  metadata: RenderMetadata,
  key: string,
  log: Logger,
): Promise<void> {
  try {
    await deps.spend({
      category: 'tts',
      units: metadata.ttsChars,
      costUsd: 0,
      meta: { renderKey: key },
    })
    const seconds = metadata.renderMs / 1000
    await deps.spend({
      category: 'render',
      units: Number(seconds.toFixed(2)),
      costUsd: renderCostUsd(seconds),
      meta: { renderKey: key },
    })
  } catch (err) {
    log.warn(errorFields(err), 'spend not recorded (non-fatal)')
  }
}

async function finishItem(
  deps: ConsumerDeps,
  itemId: string,
  progress: Progress,
  meta: Record<string, unknown>,
  log: Logger,
  attempt?: number,
): Promise<void> {
  if (progress.status === 'embedded') {
    await deps.transition({ itemId, from: 'embedded', to: 'voiced', attempt, meta })
    progress.status = 'voiced'
  }
  if (progress.status === 'voiced') {
    await deps.transition({ itemId, from: 'voiced', to: 'rendered', attempt })
    progress.status = 'rendered'
  }
  log.info('item rendered')
}

async function handleFailure(
  deps: ConsumerDeps,
  itemId: string,
  progress: Progress,
  deliveryAttempts: number,
  decision: FailureDecision,
  log: Logger,
): Promise<JobResult> {
  if (!decision.terminal) {
    log.warn({ delaySeconds: decision.retryDelaySeconds }, 'scheduling retry')
    return { action: 'retry', delaySeconds: decision.retryDelaySeconds }
  }

  try {
    if (progress.renderKey) await deps.store.markFailed(progress.renderKey, decision.code)
    if (progress.status === 'embedded' || progress.status === 'voiced') {
      await deps.transition({
        itemId,
        from: progress.status,
        to: 'failed',
        attempt: deliveryAttempts,
        error: decision.code,
      })
    }
  } catch (err) {
    if (!(err instanceof StaleTransitionError)) {
      log.error(errorFields(err), 'failure bookkeeping failed, retrying delivery')
      return { action: 'retry', delaySeconds: decision.retryDelaySeconds }
    }
    log.warn('item already moved on while recording failure')
  }
  log.error(
    { code: decision.code, deadLetter: decision.deadLetter },
    'render job terminally failed',
  )
  return decision.deadLetter ? { action: 'dead_letter' } : { action: 'ack' }
}
