import Anthropic from '@anthropic-ai/sdk'
import { log } from '../engine/log'
import type { DirectorConfig, Usage } from './config'

export const MODEL_CALL_TIMEOUT_MS = 30 * 60_000

export type ChatMessage = Anthropic.MessageParam
export type ModelReply = { text: string; stopReason: string | null; usage: Usage }
export type AskModel = (system: string, messages: ChatMessage[]) => Promise<ModelReply>

/** One streamed Messages call; the system block is cached so the review turn reads it back cheaply. */
export function createAskModel(apiKey: string, config: DirectorConfig): AskModel {
  const client = new Anthropic({ apiKey })
  return async (system, messages) => {
    const started = Date.now()
    const msg = await client.messages
      .stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          output_config: { effort: config.effort },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
        },
        { signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) },
      )
      .finalMessage()
    const u = msg.usage
    const usage: Usage = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    }
    log.info(
      { model: config.model, stop: msg.stop_reason, ...usage, ms: Date.now() - started },
      'director model reply',
    )
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return { text, stopReason: msg.stop_reason, usage }
  }
}
