import {
  DEFAULT_CHATTERBOX_VOICE,
  SETTINGS,
  getSetting,
  type Database,
  type Logger,
} from '@reelset/core'
import { DEFAULT_VOICE } from './constants'
import { QWEN_TAKES, generateChatterbox, type ChatterboxConfig } from './chatterbox'
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

type RemoteNarrator = { generate: (script: ReelScript, log: Logger) => Promise<Narration> }

export type TtsConfig = {
  voice: string
  edgeVoice: string
  fallbackEngine: FallbackEngine
  aura?: { ai: AiLike; speaker: string }
  /** Tried first when set; on failure the render falls back to chatterbox, then the container. */
  qwen?: RemoteNarrator
  chatterbox?: RemoteNarrator
}

function modalNarrator(config: Omit<ChatterboxConfig, 'fetch'>): RemoteNarrator {
  return {
    generate: (script, jobLog) =>
      generateChatterbox({ ...config, fetch: (u, init) => fetch(u, init) }, script, jobLog),
  }
}

export async function loadTtsConfig(
  db: Database,
  env: Pick<Env, 'AI' | 'TTS_VOICE' | 'CHATTERBOX_URL' | 'CHATTERBOX_TOKEN' | 'QWEN_TTS_URL'>,
  log: Logger,
): Promise<TtsConfig> {
  const edgeVoice = env.TTS_VOICE ?? DEFAULT_VOICE
  const [requested, speaker, chatterboxVoice] = await Promise.all([
    getSetting(db, SETTINGS.ttsProvider, log),
    getSetting(db, SETTINGS.ttsAuraSpeaker, log),
    getSetting(db, SETTINGS.ttsChatterboxVoice, log),
  ])
  // Both Modal narrators read the same secret, so one token serves both.
  const { CHATTERBOX_URL: url, CHATTERBOX_TOKEN: token, QWEN_TTS_URL: qwenUrl } = env
  const provider = selectProvider(
    requested,
    env.AI,
    Boolean(url && token),
    Boolean(qwenUrl && token),
  )
  if (requested !== provider) {
    log.warn({ requested, provider }, 'tts provider unavailable, starting at the next engine')
  }
  const modal = provider === 'qwen' || provider === 'chatterbox'
  return {
    voice: effectiveVoice(provider, speaker, edgeVoice),
    edgeVoice,
    fallbackEngine: fallbackEngineFor(provider),
    aura: provider === 'aura2' && env.AI ? { ai: env.AI, speaker } : undefined,
    qwen:
      provider === 'qwen' && qwenUrl && token
        ? modalNarrator({
            url: qwenUrl,
            token,
            voice: DEFAULT_CHATTERBOX_VOICE,
            engine: 'qwen',
            takes: QWEN_TAKES,
          })
        : undefined,
    chatterbox:
      modal && url && token
        ? modalNarrator({ url, token, voice: chatterboxVoice, engine: 'chatterbox' })
        : undefined,
  }
}
