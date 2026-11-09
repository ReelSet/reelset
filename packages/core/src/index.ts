export * from './db/enums'
export type * from './db/types'
export { createDb, type Database, type DbHandle, type DbOptions } from './db/client'
export { createLogger, elapsedMs, errorFields, type Logger } from './lib/logger'
export { SOURCES, parseSource, sourceSchema } from './domain/source'
export {
  PIPELINE_STAGES,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isVisibleInFeed,
  nextStage,
} from './domain/item-status'
export { contentHash, renderKey, sha256Hex, type RenderKeyInput } from './domain/hash'
export {
  EMBEDDING_DIMENSIONS,
  EmbeddingShapeError,
  fromVectorLiteral,
  toVectorLiteral,
} from './domain/embedding'
export {
  REEL_SCRIPT_VERSION,
  SCREEN_NAMES,
  SFX_NAMES,
  narrationText,
  reelScriptSchema,
  shotSchema,
  type ReelScript,
  type ScreenName,
  type SfxName,
  type Shot,
  type ReelVisual,
} from './domain/reel-script'
export {
  DEFAULT_EVIDENCE_BUDGET,
  PAPER_PARSER_VERSION,
  findFigure,
  findTable,
  isNumericCell,
  mainResultsTable,
  paperEvidenceTexts,
  paperFigureSchema,
  paperTableSchema,
  parsedPaperSchema,
  refNumber,
  tableToMarkdown,
  type PaperFigure,
  type PaperSection,
  type PaperStats,
  type PaperTable,
  type ParsedPaper,
} from './domain/parsed-paper'
export {
  ITEM_IMAGE_KINDS,
  MAX_ITEM_IMAGES,
  itemImageSchema,
  parseItemImages,
  type ItemImage,
  type ItemImageKind,
} from './domain/item-image'
export {
  SETTINGS,
  getSetting,
  parseSetting,
  setSetting,
  pipelinePauseSchema,
  type PipelinePause,
  type SettingDef,
} from './repos/settings.repo'
export {
  PIPELINE_PROBE_MINUTES,
  clearPipelinePause,
  getPipelinePause,
  pausePipeline,
} from './repos/pipeline-pause.repo'
export { recordSpend, spendTodayUsd, type SpendInput } from './repos/spend.repo'
export {
  ALERT_KEYS,
  ALERT_REPEAT_MINUTES,
  sendAlert,
  shouldSendAlert,
  type AlertInput,
  type AlertKey,
} from './repos/alerts.repo'
export {
  StaleTransitionError,
  recordItemEvent,
  setItemEmbedding,
  transitionItem,
  type ItemEventInput,
  type TransitionInput,
} from './repos/items.repo'
