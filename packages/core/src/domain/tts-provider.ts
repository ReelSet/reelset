import { z } from 'zod'

/** Narration engines the admin can pick (app_setting tts_provider). Qwen and Chatterbox run on Modal. */
export const TTS_PROVIDERS = ['edge', 'aura2', 'kokoro', 'chatterbox', 'qwen'] as const
export type TtsProvider = (typeof TTS_PROVIDERS)[number]
export const ttsProviderSchema = z.enum(TTS_PROVIDERS)
