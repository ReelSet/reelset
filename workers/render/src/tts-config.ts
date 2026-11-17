import { SETTINGS, getSetting, type Database, type Logger } from '@reelset/core'
import { DEFAULT_VOICE } from './constants'
import { generateChatterbox } from './chatterbox'
import type { Env } from './env'
import {
  effectiveVoice,
  fallbackEngineFor,
  selectProvider,
  type AiLike,
  type FallbackEngine,
  type Narration,
} from './tts'
import type { ReelScript } from '@reelset/core'

export type TtsConfig = {
  voice: string
  edgeVoice: string
  fallbackEngine: FallbackEngine
  aura?: { ai: AiLike; speaker: string }
  chatterbox?: { generate: (script: ReelScript, log: Logger) => Promise<Narration> }
}

export async function loadTtsConfig(
  db: Database,
  env: Pick<Env, 'AI' | 'TTS_VOICE' | 'CHATTERBOX_URL' | 'CHATTERBOX_TOKEN'>,
  log: Logger,
): Promise<TtsConfig> {
  const edgeVoice = env.TTS_VOICE ?? DEFAULT_VOICE
  const [requested, speaker, chatterboxVoice] = await Promise.all([
    getSetting(db, SETTINGS.ttsProvider, log),
    getSetting(db, SETTINGS.ttsAuraSpeaker, log),
    getSetting(db, SETTINGS.ttsChatterboxVoice, log),
  ])
  const { CHATTERBOX_URL: url, CHATTERBOX_TOKEN: token } = env
  const provider = selectProvider(requested, env.AI, Boolean(url && token))
  if (requested !== provider) {
    log.warn({ requested, provider }, 'tts provider unavailable, starting at the next engine')
  }
  return {
    voice: effectiveVoice(provider, speaker, edgeVoice),
    edgeVoice,
    fallbackEngine: fallbackEngineFor(provider),
    aura: provider === 'aura2' && env.AI ? { ai: env.AI, speaker } : undefined,
    chatterbox:
      provider === 'chatterbox' && url && token
        ? {
            generate: (script, jobLog) =>
              generateChatterbox(
                { url, token, voice: chatterboxVoice, fetch: (u, init) => fetch(u, init) },
                script,
                jobLog,
              ),
          }
        : undefined,
  }
}
