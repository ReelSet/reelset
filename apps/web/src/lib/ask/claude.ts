import Anthropic from '@anthropic-ai/sdk'
import { elapsedMs, errorFields, type Logger } from '@reelset/core'
import { createAnswerSplitter, type GeneratedAnswer } from './answer-stream'
import type { EvidenceChunk } from './evidence'
import { ASK_SYSTEM_PROMPT, buildAnswerPrompt } from './prompt'
import { ProviderError, isUnavailableStatus } from './provider-error'

// Low: the answer restates evidence already in the prompt, and thinking delays the first word.
const ASK_EFFORT = 'low'
// A ceiling, not a target: low-effort thinking plus a ~300-token answer; worst case about $0.004.
const MAX_OUTPUT_TOKENS = 8_000
const REQUEST_TIMEOUT_MS = 20_000
const STREAM_DEADLINE_MS = 45_000
const SDK_RETRIES = 1
const ERROR_BODY_CHARS = 160
const BILLING_BODY = /credit balance|billing|purchase credits|spend limit|usage limit/i

export type AskModelConfig = { apiKey: string; model: string }

export class ClaudeError extends ProviderError {
  constructor(message: string, unavailable: boolean, status?: number) {
    super(message, unavailable, status)
    this.name = 'ClaudeError'
  }
}

export class ClaudeRefusalError extends ClaudeError {
  constructor(readonly category: string | null) {
    super(`claude refused the request (category=${category ?? 'unknown'})`, false)
    this.name = 'ClaudeRefusalError'
  }
}

// SDK errors become ClaudeError; an exhausted credit balance arrives as a 400, so it is unavailable too.
export function toClaudeError(err: unknown): unknown {
  if (err instanceof ClaudeError || !(err instanceof Anthropic.APIError)) return err
  const status = err.status
  const body = err.message.replace(/\s+/g, ' ').slice(0, ERROR_BODY_CHARS)
  const billing = status === 400 && BILLING_BODY.test(body)
  return new ClaudeError(
    `generate returned ${status ?? 'no response'}: ${body}`,
    isUnavailableStatus(status) || billing,
    status,
  )
}

function createClient(config: AskModelConfig, fetchImpl?: typeof fetch): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    maxRetries: SDK_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

// No temperature/prefill/budget_tokens (400 on Haiku 5.5); no cache_control, prompt is under 512 tokens.
async function streamMessage(
  client: Anthropic,
  model: string,
  prompt: string,
  onDelta: (text: string) => void,
): Promise<Anthropic.Message> {
  const stream = client.messages.stream(
    {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: ASK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: ASK_EFFORT },
    },
    { signal: AbortSignal.timeout(STREAM_DEADLINE_MS) },
  )
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onDelta(event.delta.text)
    }
  }
  return stream.finalMessage()
}

// Streams answer text (minus the CITATIONS trailer) to onText; throws ClaudeError on failure.
export async function generateAnswer(
  config: AskModelConfig,
  question: string,
  chunks: readonly EvidenceChunk[],
  log: Logger,
  onText: (text: string) => void = () => undefined,
  fetchImpl?: typeof fetch,
): Promise<GeneratedAnswer> {
  const callLog = log.child({ op: 'generate', model: config.model })
  const started = performance.now()
  const splitter = createAnswerSplitter(onText)
  let message: Anthropic.Message
  try {
    message = await streamMessage(
      createClient(config, fetchImpl),
      config.model,
      buildAnswerPrompt(question, chunks),
      (delta) => splitter.push(delta),
    )
  } catch (err) {
    const mapped = toClaudeError(err)
    callLog.error(
      { durationMs: elapsedMs(started), ...errorFields(mapped) },
      'claude stream failed',
    )
    throw mapped
  }

  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
  const stopReason = message.stop_reason
  callLog.info({ stopReason, ...usage, durationMs: elapsedMs(started) }, 'claude stream finished')
  if (stopReason === 'refusal') throw new ClaudeRefusalError(message.stop_details?.category ?? null)
  if (stopReason === 'max_tokens')
    callLog.warn({ maxTokens: MAX_OUTPUT_TOKENS }, 'answer truncated')

  const { text, parsed } = splitter.finish()
  if (!text.trim()) throw new ClaudeError(`empty generation (stop_reason=${stopReason})`, true)
  return { text, ...usage, parsed }
}
