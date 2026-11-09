import { SETTINGS, type SettingDef } from '@reelset/core'

export type SettingKind = 'number' | 'list'

export type SettingField = {
  name: keyof typeof SETTINGS
  def: SettingDef<unknown>
  kind: SettingKind
  hint: string
}

const HINTS: Record<string, string> = {
  daily_reel_cap: 'Max items admitted to the pipeline per UTC day',
  min_item_score: 'Admission threshold, 0 to 1',
  reel_retention_days: 'Days a reel stays in R2 after publishing',
  pipeline_daily_spend_cap_usd: 'Ingest and render spend cap per UTC day, USD',
  ask_daily_spend_cap_usd: 'Ask spend cap per UTC day, USD',
  ask_hourly_limit_per_user: 'Ask questions per user per hour',
  reddit_subreddits: 'One subreddit per line',
  youtube_search_queries: 'One YouTube search query per line (commas are kept)',
  youtube_max_age_days: 'Only videos published within this many days, 1 to 30',
  youtube_results_per_query: 'Search results fetched per query',
  news_feeds: 'One RSS or Atom URL per line',
}

export function settingFields(): SettingField[] {
  return (Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]).map((name) => {
    const def = SETTINGS[name] as SettingDef<unknown>
    return {
      name,
      def,
      kind: Array.isArray(def.default) ? 'list' : 'number',
      hint: HINTS[def.key] ?? '',
    }
  })
}

export function formatSettingInput(kind: SettingKind, value: unknown): string {
  if (kind === 'list') return Array.isArray(value) ? value.join('\n') : ''
  return String(value ?? '')
}

export type ParsedSetting = { ok: true; value: unknown } | { ok: false; error: string }

export function parseSettingInput(
  field: Pick<SettingField, 'kind'> & { def: Pick<SettingDef<unknown>, 'key' | 'schema'> },
  raw: unknown,
): ParsedSetting {
  if (typeof raw !== 'string') return { ok: false, error: 'value is required' }

  let candidate: unknown
  if (field.kind === 'list') {
    const separator = field.def.key === 'youtube_search_queries' ? /\n/ : /[\n,]/
    candidate = raw
      .split(separator)
      .map((line) => line.trim())
      .filter(Boolean)
  } else {
    const text = raw.trim()
    candidate = text === '' ? Number.NaN : Number(text)
  }

  const parsed = field.def.schema.safeParse(candidate)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, error: issue ? issue.message : 'invalid value' }
}
