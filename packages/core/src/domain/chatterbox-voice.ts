import { z } from 'zod'

/** Reference clips baked into the Chatterbox service (workers/tts-modal/voices/<name>.wav). */
export const CHATTERBOX_VOICES = ['genz', 'voice4', 'af_heart'] as const
export type ChatterboxVoice = (typeof CHATTERBOX_VOICES)[number]
export const DEFAULT_CHATTERBOX_VOICE: ChatterboxVoice = 'genz'
export const chatterboxVoiceSchema = z.enum(CHATTERBOX_VOICES)
