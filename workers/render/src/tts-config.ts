import { SETTINGS, getSetting, type Database, type Logger } from '@reelset/core'
import { DEFAULT_VOICE } from './constants'
import type { Env } from './env'
import {
  effectiveVoice,
  fallbackEngineFor,
  selectProvider,
  type AiLike,
  type FallbackEngine,
} from './tts'

export type TtsConfig = {
  voice: string
  edgeVoice: string
  fallbackEngine: FallbackEngine
  aura?: { ai: AiLike; speaker: string }
}

export async function loadTtsConfig(
  db: Database,
  env: Pick<Env, 'AI' | 'TTS_VOICE'>,
  log: Logger,
): Promise<TtsConfig> {
  const edgeVoice = env.TTS_VOICE ?? DEFAULT_VOICE
  const [requested, speaker] = await Promise.all([
    getSetting(db, SETTINGS.ttsProvider, log),
    getSetting(db, SETTINGS.ttsAuraSpeaker, log),
  ])
  const provider = selectProvider(requested, env.AI)
  if (requested !== provider) {
    log.warn({ requested, provider }, 'tts provider unavailable, starting at the next engine')
  }
  return {
    voice: effectiveVoice(provider, speaker, edgeVoice),
    edgeVoice,
    fallbackEngine: fallbackEngineFor(provider),
    aura: provider === 'aura2' && env.AI ? { ai: env.AI, speaker } : undefined,
  }
}
