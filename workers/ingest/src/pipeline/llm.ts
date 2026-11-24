import {
  SETTINGS,
  getSetting,
  type ClaudeEffort,
  type ClaudeModel,
  type Database,
  type Logger,
  type TtsProvider,
} from '@reelset/core'
import { createClaudeClient } from './claude'
import type { LlmClient } from './output'

export const LLM_PROVIDER = 'anthropic'

export type LlmModels = {
  scriptModel: ClaudeModel
  scriptEffort: ClaudeEffort
  imageVetModel: ClaudeModel
  /** The voice that will read the scripts; Qwen gets its own prompt rules. */
  narrator: TtsProvider
}

export type LlmConfig = { apiKey?: string; model: ClaudeModel; effort: ClaudeEffort }

export type LlmSelection = { model: ClaudeModel; effort: ClaudeEffort; client: LlmClient }

/** Admin-selected models from app_setting; an invalid row falls back to its default. */
export async function loadLlmModels(db: Database, log: Logger): Promise<LlmModels> {
  const [scriptModel, scriptEffort, imageVetModel, narrator] = await Promise.all([
    getSetting(db, SETTINGS.scriptModel, log),
    getSetting(db, SETTINGS.scriptEffort, log),
    getSetting(db, SETTINGS.imageVetModel, log),
    getSetting(db, SETTINGS.ttsProvider, log),
  ])
  return { scriptModel, scriptEffort, imageVetModel, narrator }
}

/** Script generation client on Claude; throws without CLAUDE_API_KEY. */
export function createLlm(config: LlmConfig, log: Logger): LlmSelection {
  if (!config.apiKey) throw new Error('CLAUDE_API_KEY is required for script generation')
  const { model, effort } = config
  return { model, effort, client: createClaudeClient(config.apiKey, model, log, { effort }) }
}
