import { sql } from 'kysely'
import { z } from 'zod'
import type { Database } from '../db/client'
import {
  DEFAULT_CLAUDE_MODEL,
  claudeEffortSchema,
  claudeModelSchema,
  type ClaudeEffort,
} from '../domain/claude-model'
import {
  DIRECTOR_DEFAULT_RULES,
  DIRECTOR_DEFAULT_REVIEW,
  DIRECTOR_MAX_MAX_TOKENS,
  DIRECTOR_MIN_MAX_TOKENS,
  DIRECTOR_REVIEW_MAX_CHARS,
  DIRECTOR_REVIEW_MIN_CHARS,
  DIRECTOR_RULES_MAX_CHARS,
  DIRECTOR_RULES_MIN_CHARS,
  directorEffortSchema,
  type DirectorEffort,
} from '../domain/director'
import type { Logger } from '../lib/logger'

export type SettingDef<T> = { key: string; schema: z.ZodType<T>; default: T }

function def<T>(key: string, schema: z.ZodType<T>, fallback: T): SettingDef<T> {
  return { key, schema, default: fallback }
}

export const pipelinePauseSchema = z.object({
  reason: z.string().max(300),
  since: z.string(),
  until: z.string(),
})
export type PipelinePause = z.infer<typeof pipelinePauseSchema>

export const SETTINGS = {
  dailyReelCap: def('daily_reel_cap', z.number().int().positive(), 10),
  minItemScore: def('min_item_score', z.number().min(0).max(1), 0.35),
  feedMinTemplate: def('feed_min_template', z.number().int().min(0), 0),
  reelRetentionDays: def('reel_retention_days', z.number().int().positive(), 30),
  pipelineDailySpendCapUsd: def('pipeline_daily_spend_cap_usd', z.number().positive(), 10),
  askDailySpendCapUsd: def('ask_daily_spend_cap_usd', z.number().positive(), 5),
  askHourlyLimitPerUser: def('ask_hourly_limit_per_user', z.number().int().positive(), 20),
  redditSubreddits: def('reddit_subreddits', z.array(z.string().min(1)), [
    'programming',
    'MachineLearning',
    'LocalLLaMA',
    'StableDiffusion',
    'webdev',
    'devops',
    'ExperiencedDevs',
    'selfhosted',
    'singularity',
    'OpenAI',
    'ClaudeAI',
    'rust',
    'golang',
  ]),
  youtubeSearchQueries: def('youtube_search_queries', z.array(z.string().min(2).max(100)).max(30), [
    'open source AI model release',
    'new AI video model',
    'LLM benchmark comparison',
    'coding agent review',
    'Claude Code',
    'Cursor vs',
    'open weights model',
    'github trending projects',
    'developer tools 2026',
    'AI research paper explained',
    'self-hosted AI',
    'new Rust Go release',
  ]),
  youtubeMaxAgeDays: def('youtube_max_age_days', z.number().int().min(1).max(30), 7),
  youtubeResultsPerQuery: def('youtube_results_per_query', z.number().int().min(1).max(20), 15),
  newsFeeds: def('news_feeds', z.array(z.url()), [
    'https://github.blog/feed/',
    'https://blog.cloudflare.com/rss/',
    'https://huggingface.co/blog/feed.xml',
  ]),
  papersHfLimit: def('papers_hf_limit', z.number().int().min(1).max(100), 50),
  papersArxivCategories: def(
    'papers_arxiv_categories',
    z.array(z.string().min(2).max(20)).max(12),
    ['cs.AI', 'cs.CL', 'cs.CV', 'cs.LG'],
  ),
  papersArxivPerCategory: def('papers_arxiv_per_category', z.number().int().min(0).max(50), 10),
  papersMaxAgeDays: def('papers_max_age_days', z.number().int().min(1).max(30), 7),
  scrapeDailySpendCapUsd: def('scrape_daily_spend_cap_usd', z.number().positive(), 1),
  ttsProvider: def(
    'tts_provider',
    z.enum(['edge', 'aura2', 'kokoro']),
    'edge' as 'edge' | 'aura2' | 'kokoro',
  ),
  scriptModel: def('script_model', claudeModelSchema, DEFAULT_CLAUDE_MODEL),
  // Medium: low skips the self-checks that keep narration on length; higher adds cost, no gain seen.
  scriptEffort: def('script_effort', claudeEffortSchema, 'medium' as ClaudeEffort),
  imageVetModel: def('image_vet_model', claudeModelSchema, DEFAULT_CLAUDE_MODEL),
  askModel: def('ask_model', claudeModelSchema, DEFAULT_CLAUDE_MODEL),
  ttsAuraSpeaker: def('tts_aura_speaker', z.string().regex(/^[a-z]{3,20}$/), 'hera'),
  renderUpgradeEnabled: def('render_upgrade_enabled', z.boolean(), false),
  instagramAutoPost: def('instagram_auto_post', z.boolean(), true),
  directorEnabled: def('director_enabled', z.boolean(), true),
  directorModel: def('director_model', claudeModelSchema, DEFAULT_CLAUDE_MODEL),
  directorEffort: def('director_effort', directorEffortSchema, 'medium' as DirectorEffort),
  directorReview: def('director_review', z.boolean(), true),
  directorMaxTokens: def(
    'director_max_tokens',
    z.number().int().min(DIRECTOR_MIN_MAX_TOKENS).max(DIRECTOR_MAX_MAX_TOKENS),
    DIRECTOR_MAX_MAX_TOKENS,
  ),
  directorRules: def(
    'director_rules',
    z.string().min(DIRECTOR_RULES_MIN_CHARS).max(DIRECTOR_RULES_MAX_CHARS),
    DIRECTOR_DEFAULT_RULES,
  ),
  directorReviewPrompt: def(
    'director_review_prompt',
    z.string().min(DIRECTOR_REVIEW_MIN_CHARS).max(DIRECTOR_REVIEW_MAX_CHARS),
    DIRECTOR_DEFAULT_REVIEW,
  ),
  pipelinePaused: def('pipeline_paused', pipelinePauseSchema.nullable(), null),
} as const

/** The allowed values of an enum setting, or null for any other schema. */
export function settingEnumOptions(setting: SettingDef<unknown>): readonly string[] | null {
  if (!(setting.schema instanceof z.ZodEnum)) return null
  return setting.schema.options.map(String)
}

export function parseSetting<T>(setting: SettingDef<T>, raw: unknown, log: Logger): T {
  if (raw === undefined || raw === null) return setting.default
  const parsed = setting.schema.safeParse(raw)
  if (parsed.success) return parsed.data
  log.warn({ key: setting.key }, 'invalid app_setting value, using default')
  return setting.default
}

export async function getSetting<T>(db: Database, setting: SettingDef<T>, log: Logger): Promise<T> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', setting.key)
    .executeTakeFirst()
  return parseSetting(setting, row?.value, log)
}

export async function setSetting<T>(db: Database, setting: SettingDef<T>, value: T, log: Logger) {
  const valid = setting.schema.parse(value)
  await db
    .insertInto('app_setting')
    .values({ key: setting.key, value: JSON.stringify(valid) })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({ value: JSON.stringify(valid), updated_at: sql`now()` }),
    )
    .execute()
  log.info({ key: setting.key }, 'app_setting updated')
}
