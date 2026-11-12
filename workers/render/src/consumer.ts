import { z } from 'zod'
import {
  StaleTransitionError,
  claudeCostUsd,
  claudeModelSchema,
  errorFields,
  reelScriptSchema,
  renderKey as computeRenderKey,
  type DirectorMeta,
  type DirectorPayload,
  type ItemStatus,
  type Logger,
  type ReelScript,
  type SpendInput,
  type TransitionInput,
} from '@reelset/core'
import {
  createContainerClient,
  type ContainerFetcher,
  type RenderMetadata,
} from './container-client'
import {
  BUSY_MAX_DEFERRALS,
  BUSY_RETRY_DELAY_SECONDS,
  MAX_VIDEO_BYTES,
  TEMPLATE_VERSION,
} from './constants'
import { RenderJobError, isBusyCode } from './errors'
import {
  MAX_NARRATION_SECONDS,
  MAX_SHORTEN_ATTEMPTS,
  SHORTEN_MARGIN_SECONDS,
  audioToBase64,
  generateNarration,
  narrationText,
  shortenScript,
  speakableNumbers,
  wordsToJson,
  type AiLike,
  type FallbackEngine,
  type Narration,
} from './tts'
import type { BrollPick } from './pexels'
import { containerJobId, posterKeyFor, videoKeyFor } from './keys'
import {
  classifyFailure,
  collectImageUrls,
  containerTitle,
  decideRenderAction,
  renderCostUsd,
  sourceImageUrls,
  type FailureDecision,
} from './plan'
import type { ItemForRender, RenderStore } from './store'

export const jobMessageSchema = z.object({
  itemId: z.uuid(),
  attempt: z.number().int().nonnegative().optional(),
  deferrals: z.number().int().nonnegative().optional(),
})
export type JobMessage = z.infer<typeof jobMessageSchema>

export type JobResult =
  | { action: 'ack' }
  | { action: 'retry'; delaySeconds: number }
  | { action: 'defer'; delaySeconds: number; message: JobMessage }
  | { action: 'dead_letter' }

export type ConsumerDeps = {
  store: RenderStore
  box: ContainerFetcher
  media: Pick<R2Bucket, 'put'>
  transition: (input: TransitionInput) => Promise<void>
  spend: (input: SpendInput) => Promise<void>
  voice: string
  edgeVoice?: string
  fallbackEngine?: FallbackEngine
  aura?: { ai: AiLike; speaker: string }
  /** Stock clips for the reel; optional, failures never fail a render. */
  broll?: (script: ReelScript, item: ItemForRender) => Promise<BrollPick[]>
  /** Director config for the box, or null when switched off; a failure renders without it. */
  director?: () => Promise<DirectorPayload | null>
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
    const deferral = busyDeferral(err, parsed.data)
    if (deferral) {
      await releaseRenderForRetry(deps, progress.renderKey, log)
      log.info({ deferrals: deferral.message.deferrals }, 'render box busy, deferring job')
      return deferral
    }
    const decision = classifyFailure(err, deliveryAttempts)
    log.error(
      { ...errorFields(err), code: decision.code, terminal: decision.terminal },
      'render job failed',
    )
    return handleFailure(deps, itemId, progress, deliveryAttempts, decision, log)
  }
}

/** A busy box is waiting, not failing: re-enqueue a fresh message so the retry budget stays intact. */
function busyDeferral(
  err: unknown,
  message: JobMessage,
): Extract<JobResult, { action: 'defer' }> | null {
  if (!(err instanceof RenderJobError) || !isBusyCode(err.code)) return null
  const deferrals = (message.deferrals ?? 0) + 1
  if (deferrals > BUSY_MAX_DEFERRALS) return null
  return {
    action: 'defer',
    delaySeconds: BUSY_RETRY_DELAY_SECONDS,
    message: { itemId: message.itemId, deferrals },
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
  const rlog = log.child({ renderKey: key, jobId: containerJobId(key) })

  const existing = await deps.store.ensureRender(item.id, key, Number(TEMPLATE_VERSION))
  const action = decideRenderAction(item.status, existing)
  rlog.info({ action: action.kind, renderStatus: existing.status }, 'render decision')
  if (action.kind === 'skip') return { action: 'ack' }
  if (action.kind === 'finish') {
    await finishItem(deps, item.id, progress, { resumed: true }, rlog)
    return { action: 'ack' }
  }

  await deps.store.markRendering(key)
  const { narration, script: renderScript } = await prepareNarration(deps, script.data, rlog)
  const metadata = await renderAndUpload(deps, item, renderScript, key, narration, rlog)
  logNarrationProvider(deps, metadata, narration, rlog)
  await recordSpend(deps, metadata, key, narration, rlog)
  await recordDirectorSpend(deps, metadata.director, key, rlog)
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

type Prepared = { narration: Narration | null; script: ReelScript }

function combine(first: Narration, second: Narration): Narration {
  return {
    ...second,
    chars: first.chars + second.chars,
    costUsd: Number((first.costUsd + second.costUsd).toFixed(6)),
  }
}

function logFallback(deps: ConsumerDeps, reason: string, log: Logger, extra: object = {}): void {
  const to = deps.fallbackEngine ?? 'edge'
  log.warn({ from: 'aura2', to, reason, ...extra }, 'aura tts unusable, falling back')
}

async function generateAura(
  aura: NonNullable<ConsumerDeps['aura']>,
  script: ReelScript,
  log: Logger,
): Promise<Narration> {
  log.info({ provider: 'aura2', speaker: aura.speaker }, 'tts provider attempt')
  return generateNarration(aura.ai, narrationText(script), aura.speaker, log)
}

/** Aura over the cap is re-synthesized from progressively shorter scripts; any Aura failure hands off to the container's kokoro then edge chain. */
async function prepareNarration(
  deps: ConsumerDeps,
  rawScript: ReelScript,
  log: Logger,
): Promise<Prepared> {
  const script = speakableNumbers(rawScript)
  const aura = deps.aura
  if (!aura) {
    log.info({ provider: deps.fallbackEngine ?? 'edge' }, 'tts provider attempt')
    return { narration: null, script }
  }
  try {
    const within = await synthesizeWithinCap(aura, script, log)
    if (within) return within
    logFallback(deps, 'over_cap', log)
  } catch (err) {
    logFallback(deps, 'aura_failed', log, errorFields(err))
  }
  return { narration: null, script }
}

async function synthesizeWithinCap(
  aura: NonNullable<ConsumerDeps['aura']>,
  script: ReelScript,
  log: Logger,
): Promise<Prepared | null> {
  let current = script
  let total: Narration | null = null
  for (let attempt = 0; attempt <= MAX_SHORTEN_ATTEMPTS; attempt++) {
    const next = await generateAura(aura, current, log)
    total = total ? combine(total, next) : next
    if (next.audioSeconds <= MAX_NARRATION_SECONDS) return { narration: total, script: current }
    const ratio = (MAX_NARRATION_SECONDS - SHORTEN_MARGIN_SECONDS) / next.audioSeconds
    const shorter = shortenScript(current, ratio)
    if (!shorter) return null
    log.warn(
      { audioSeconds: next.audioSeconds, attempt },
      'aura narration too long, retrying shorter',
    )
    current = shorter
  }
  return null
}

async function renderAndUpload(
  deps: ConsumerDeps,
  item: ItemForRender,
  script: ReelScript,
  key: string,
  narration: Narration | null,
  log: Logger,
): Promise<RenderMetadata> {
  const jobId = containerJobId(key)
  const broll = await fetchBroll(deps, item, script, log)
  const director = await loadDirector(deps, log)
  const client = createContainerClient(deps.box, log)
  const metadata = await client.render({
    jobId,
    script,
    title: containerTitle(item.title),
    sourceLabel: item.sourceLabel,
    imageUrls: collectImageUrls(script),
    voice: narration ? deps.voice : (deps.edgeVoice ?? deps.voice),
    ttsEngine: narration ? undefined : (deps.fallbackEngine ?? 'edge'),
    narration: narration
      ? { audioBase64: audioToBase64(narration.audio), words: wordsToJson(narration.words) }
      : undefined,
    source: item.source,
    canonicalUrl: item.canonicalUrl,
    sourceImageUrls: sourceImageUrls(item.source, [item.canonicalUrl, item.mentionUrl]),
    images: item.images,
    facts: item.facts,
    broll: broll.length > 0 ? broll : undefined,
    demo: item.demo,
    director: director ?? undefined,
  })
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
      credits: metadata.credits,
      box: metadata.box,
      director: metadata.director,
    })
    return metadata
  } finally {
    await client.remove(jobId)
  }
}

async function loadDirector(deps: ConsumerDeps, log: Logger): Promise<DirectorPayload | null> {
  if (!deps.director) return null
  try {
    const director = await deps.director()
    log.info(
      director
        ? {
            model: director.model,
            effort: director.effort,
            review: director.review,
            skills: director.skills.length,
            hasExample: director.example !== null,
          }
        : {},
      director
        ? 'director enabled for render'
        : 'director disabled, box uses its built-in renderer',
    )
    return director
  } catch (err) {
    log.warn(errorFields(err), 'director config not loaded, rendering without it')
    return null
  }
}

async function fetchBroll(
  deps: ConsumerDeps,
  item: ItemForRender,
  script: ReelScript,
  log: Logger,
): Promise<BrollPick[]> {
  if (!deps.broll) return []
  try {
    return await deps.broll(script, item)
  } catch (err) {
    log.warn(errorFields(err), 'b-roll skipped')
    return []
  }
}

function logNarrationProvider(
  deps: ConsumerDeps,
  metadata: RenderMetadata,
  narration: Narration | null,
  log: Logger,
): void {
  const provider = narration ? 'aura2' : containerProvider(metadata)
  log.info({ provider }, 'narration provider used')
  if (!narration && deps.fallbackEngine === 'kokoro' && provider === 'edge') {
    log.warn({ from: 'kokoro', to: 'edge' }, 'kokoro failed in the container, edge-tts used')
  }
}

function containerProvider(metadata: RenderMetadata): 'kokoro' | 'edge' {
  return metadata.ttsProvider === 'kokoro' ? 'kokoro' : 'edge'
}

async function recordSpend(
  deps: ConsumerDeps,
  metadata: RenderMetadata,
  key: string,
  narration: Narration | null,
  log: Logger,
): Promise<void> {
  try {
    await deps.spend({
      category: 'tts',
      units: metadata.ttsChars,
      costUsd: narration?.costUsd ?? 0,
      meta: { renderKey: key, provider: narration ? 'aura2' : containerProvider(metadata) },
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

async function recordDirectorSpend(
  deps: ConsumerDeps,
  director: DirectorMeta | undefined,
  key: string,
  log: Logger,
): Promise<void> {
  if (!director) return
  const usage = {
    inputTokens: director.inputTokens,
    outputTokens: director.outputTokens,
    cacheReadTokens: director.cacheReadTokens,
    cacheWriteTokens: director.cacheWriteTokens,
  }
  const units = Object.values(usage).reduce((sum, n) => sum + n, 0)
  log.info(
    {
      used: director.used,
      fallbackReason: director.fallbackReason,
      scenes: director.scenes,
      ...usage,
    },
    'director result',
  )
  if (units === 0) return
  const model = claudeModelSchema.safeParse(director.model)
  if (!model.success) {
    log.warn({ model: director.model }, 'director spend not recorded: unknown model')
    return
  }
  try {
    await deps.spend({
      category: 'llm',
      units: usage.inputTokens + usage.outputTokens,
      costUsd: claudeCostUsd(model.data, usage),
      meta: { model: model.data, provider: 'anthropic', stage: 'director', renderKey: key },
    })
  } catch (err) {
    log.warn(errorFields(err), 'director spend not recorded (non-fatal)')
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

/** A render waiting for a queue retry is not running, so the stuck reaper must not fail it. */
async function releaseRenderForRetry(
  deps: ConsumerDeps,
  renderKey: string | null,
  log: Logger,
): Promise<void> {
  if (!renderKey) return
  try {
    await deps.store.markRetryPending(renderKey)
  } catch (err) {
    log.warn(errorFields(err), 'could not release render for retry (non-fatal)')
  }
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
    await releaseRenderForRetry(deps, progress.renderKey, log)
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
