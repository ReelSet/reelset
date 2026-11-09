import { sql } from 'kysely'
import { z } from 'zod'
import type { Database } from '../db/client'
import type { Logger } from '../lib/logger'

export type SettingDef<T> = { key: string; schema: z.ZodType<T>; default: T }

function def<T>(key: string, schema: z.ZodType<T>, fallback: T): SettingDef<T> {
  return { key, schema, default: fallback }
}

export const SETTINGS = {
  dailyReelCap: def('daily_reel_cap', z.number().int().positive(), 200),
  minItemScore: def('min_item_score', z.number().min(0).max(1), 0.35),
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
} as const

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
