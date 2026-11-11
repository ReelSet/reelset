import Anthropic from '@anthropic-ai/sdk'
import { errorFields, type Logger } from '@reelset/core'
import { QuotaExhaustedError } from './quota'
import type { LlmClient, LlmImage, LlmUsage } from './output'

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5'

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Medium (the model default) is pinned explicitly: scripts need grounded numbers and a sharp
// hook, which benefit from some reasoning, while low skips the self-checks that keep narration at
// 100-112 words. Higher levels cost far more output tokens for no measurable gain on this task.
export const DEFAULT_CLAUDE_EFFORT: ClaudeEffort = 'medium'

// Room for adaptive thinking plus a ~1.5K-token JSON script.
const MAX_OUTPUT_TOKENS = 16_000
const REQUEST_TIMEOUT_MS = 120_000
const SDK_RETRIES = 2

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeError'
  }
}

export class ClaudeRefusalError extends ClaudeError {
  constructor(readonly category: string | null) {
    super(`claude refused the request (category=${category ?? 'unknown'})`)
    this.name = 'ClaudeRefusalError'
  }
}

type ApiErrorLike = { status?: number; message?: string }

const BILLING_BODY = /credit balance|billing|purchase credits|spend limit|usage limit/i

/**
 * 401 (bad or revoked key) and 402 (billing) cannot succeed on retry, so they pause the pipeline
 * like exhausted quota does. A 400 or 429 only counts when the body says credits or limits.
 */
export function asClaudeQuotaError(err: unknown): unknown {
  if (!(err instanceof Anthropic.APIError)) return err
  const { status, message } = err as ApiErrorLike
  const body = (message ?? '').replace(/\s+/g, ' ').slice(0, 160)
  const quota =
    status === 401 ||
    status === 402 ||
    ((status === 400 || status === 429 || status === 403) && BILLING_BODY.test(body))
  return quota && status ? new QuotaExhaustedError(status, `Claude HTTP ${status}: ${body}`) : err
}

type ClaudeUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function claudeUsage(usage: ClaudeUsage): LlmUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

// USD per 1M tokens for claude-haiku-5-5. Two rate cards chosen by total prompt size.
const HAIKU_SMALL = { input: 0.1, output: 0.5 }
const HAIKU_LARGE = { input: 0.5, output: 2.5 }
const LARGE_PROMPT_TOKENS = 100_000
const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25

export function claudeCostUsd(usage: LlmUsage): number {
  const read = usage.cacheReadTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  const rate = usage.inputTokens + read + write > LARGE_PROMPT_TOKENS ? HAIKU_LARGE : HAIKU_SMALL
  return (
    (usage.inputTokens * rate.input +
      read * rate.input * CACHE_READ_MULT +
      write * rate.input * CACHE_WRITE_MULT +
      usage.outputTokens * rate.output) /
    1_000_000
  )
}

type ContentBlock = { type: string; text?: string }

export type ClaudeMessage = {
  content: ContentBlock[]
  stop_reason: string | null
  stop_details?: { category?: string | null } | null
  usage: ClaudeUsage
}

export function parseClaudeMessage(message: ClaudeMessage): { text: string; usage: LlmUsage } {
  if (message.stop_reason === 'refusal') {
    throw new ClaudeRefusalError(message.stop_details?.category ?? null)
  }
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeError('claude output hit max_tokens before finishing the JSON')
  }
  if (!text.trim()) {
    throw new ClaudeError(`empty claude response (stop_reason=${message.stop_reason ?? 'none'})`)
  }
  return { text, usage: claudeUsage(message.usage) }
}

export type ClaudeOptions = {
  effort?: ClaudeEffort
  fetch?: typeof fetch
}

/**
 * Plain JSON output plus the shared parse/repair/rejection loop. Structured outputs are not used:
 * the script schema is a deep union of visuals and screens with many length limits, which
 * JSON-schema grammars do not enforce, so the repair step is needed regardless.
 * No temperature, prefill or budget_tokens: all return 400 on Haiku 5.5.
 */
export function createClaudeClient(
  apiKey: string,
  model: string,
  log: Logger,
  options: ClaudeOptions = {},
): LlmClient {
  const effort = options.effort ?? DEFAULT_CLAUDE_EFFORT
  const client = new Anthropic({
    apiKey,
    maxRetries: SDK_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  const call = async (system: string, user: string, images: readonly LlmImage[]) => {
    const message = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent(user, images) }],
      output_config: { effort },
    })
    const result = parseClaudeMessage(message as unknown as ClaudeMessage)
    log.debug(
      { model, effort, images: images.length, stopReason: message.stop_reason },
      'claude call done',
    )
    return result
  }
  return {
    generate: async ({ system, user, images = [] }) => {
      try {
        try {
          return await call(system, user, images)
        } catch (err) {
          if (images.length === 0 || !isImageRejection(err)) throw err
          log.warn(
            { images: images.length, ...errorFields(err) },
            'claude rejected the attached images, retrying text only',
          )
          return await call(system, user, [])
        }
      } catch (err) {
        const mapped = asClaudeQuotaError(err)
        if (!(mapped instanceof QuotaExhaustedError))
          log.warn(errorFields(mapped), 'claude call failed')
        throw mapped
      }
    },
  }
}

const CLAUDE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function imageBlock(image: LlmImage): Anthropic.ImageBlockParam | null {
  const mime = image.mime === 'image/jpg' ? 'image/jpeg' : image.mime
  if (!CLAUDE_IMAGE_MIMES.has(mime)) return null
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mime as Anthropic.Base64ImageSource['media_type'],
      data: image.base64,
    },
  }
}

/** Images go before the text: Claude reads image-then-question best. */
export function userContent(
  user: string,
  images: readonly LlmImage[],
): string | Anthropic.ContentBlockParam[] {
  const blocks = images.map(imageBlock).filter((b): b is Anthropic.ImageBlockParam => b !== null)
  if (blocks.length === 0) return user
  return [...blocks, { type: 'text', text: user }]
}

export function isImageRejection(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false
  return err.status === 400 && /image/i.test(err.message ?? '')
}
