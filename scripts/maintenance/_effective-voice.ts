import { SETTINGS, getSetting, createLogger, type Database } from '@reelset/core'
import { DEFAULT_VOICE } from '../../workers/render/src/constants'
import { effectiveVoice } from '../../workers/render/src/tts'

/** Voice the render worker uses for render keys right now (aura2-<speaker> or the edge voice). */
export async function currentVoice(db: Database): Promise<string> {
  const log = createLogger({ app: 'maintenance', level: 'warn' })
  const [provider, speaker] = await Promise.all([
    getSetting(db, SETTINGS.ttsProvider, log),
    getSetting(db, SETTINGS.ttsAuraSpeaker, log),
  ])
  return effectiveVoice(provider, speaker, DEFAULT_VOICE)
}
