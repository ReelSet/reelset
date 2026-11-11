import Anthropic from '@anthropic-ai/sdk'
import { SETTINGS, errorFields, type ClaudeEffort, type Logger } from '@reelset/core'
import { QuotaExhaustedError } from './quota'
import type { LlmClient, LlmImage, LlmUsage } from './output'

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

// 401/402 never succeed on retry, so they pause like quota; 400/429 only with a credits body.
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

// Plain JSON plus repair (grammars miss the length limits); no sampling/prefill/budget (400 on 5.5).
export function createClaudeClient(
  apiKey: string,
  model: string,
  log: Logger,
  options: ClaudeOptions = {},
): LlmClient {
  const effort = options.effort ?? SETTINGS.scriptEffort.default
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
