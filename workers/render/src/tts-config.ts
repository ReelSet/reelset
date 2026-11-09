import { SETTINGS, getSetting, type Database, type Logger } from '@reelset/core'
import { DEFAULT_VOICE } from './constants'
import type { Env } from './env'
import { effectiveVoice, selectProvider, type AiLike } from './tts'

export type TtsConfig = {
  voice: string
  edgeVoice: string
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
  if (requested !== provider) log.warn('tts_provider is aura2 but the AI binding is missing')
  return {
    voice: effectiveVoice(provider, speaker, edgeVoice),
    edgeVoice,
    aura: provider === 'aura2' && env.AI ? { ai: env.AI, speaker } : undefined,
  }
}
