import {
  CLAUDE_MODELS,
  CLAUDE_PRICING,
  DEFAULT_CLAUDE_MODEL,
  SETTINGS,
  settingEnumOptions,
  type ClaudeModel,
  type SettingDef,
} from '@reelset/core'

export type SettingKind = 'number' | 'list' | 'enum' | 'boolean'

type SettingFieldBase = { name: keyof typeof SETTINGS; def: SettingDef<unknown>; hint: string }

export type SettingField = SettingFieldBase &
  ({ kind: 'number' | 'list' | 'boolean' } | { kind: 'enum'; options: readonly string[] })

function formatUsd(perMTok: number): string {
  return perMTok < 1 ? `$${perMTok.toFixed(2)}` : `$${perMTok}`
}

function modelPriceLabel(model: ClaudeModel): string {
  const { input, output } = CLAUDE_PRICING[model].standard
  const times = Math.round(input / CLAUDE_PRICING[DEFAULT_CLAUDE_MODEL].standard.input)
  const tier = model.split('-')[1] ?? model
  return `${tier} ${formatUsd(input)}/${formatUsd(output)} (${times}x)`
}

// Built from the core price table so the hint never drifts from what spend tracking charges.
const MODEL_PRICES = `per MTok in/out: ${CLAUDE_MODELS.map(modelPriceLabel).join(', ')}`

const HINTS: Record<string, string> = {
  daily_reel_cap:
    'Reels made per UTC day (max items admitted to the pipeline); also caps Instagram auto posts',
  render_max_in_flight:
    'Max items queued or rendering at once; the rest wait as embedded until a render box frees up',
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
  tts_provider: 'Narration voice: edge (free), aura2 (Workers AI, paid per char), kokoro (local)',
  script_model: `Writes reel scripts from the next ingest batch; ${MODEL_PRICES}`,
  script_effort: 'Script thinking depth; medium keeps narration on length, high costs more output',
  image_vet_model: `Vets up to 6 images per item; ${MODEL_PRICES}`,
  ask_model: `Answers Ask questions from the next request; ${MODEL_PRICES}`,
  render_upgrade_enabled: 'Re-render older reels when a newer template ships',
  show_view_count: 'Show the view count on reels once it reaches view_count_threshold',
  view_count_threshold: 'Minimum views before the count is shown (0 = always)',
  show_like_count: 'Show the like count on reels once it reaches like_count_threshold',
  like_count_threshold: 'Minimum likes before the count is shown (0 = always, shows 0)',
  show_save_count: 'Show the save count on reels once it reaches save_count_threshold',
  save_count_threshold: 'Minimum saves before the count is shown (0 = always)',
  instagram_auto_post:
    'Queue every new reel for Instagram (up to daily_reel_cap per day); false = post by hand only',
}

function settingField(name: keyof typeof SETTINGS): SettingField {
  const def = SETTINGS[name] as SettingDef<unknown>
  const base = { name, def, hint: HINTS[def.key] ?? '' }
  const options = settingEnumOptions(def)
  if (options) return { ...base, kind: 'enum', options }
  if (typeof def.default === 'boolean') return { ...base, kind: 'boolean' }
  return { ...base, kind: Array.isArray(def.default) ? 'list' : 'number' }
}

const DIRECTOR_KEY_PREFIX = 'director_'

// Director settings have their own page (long text, skills); the generic form cannot edit strings.
export function settingFields(): SettingField[] {
  return (Object.keys(SETTINGS) as (keyof typeof SETTINGS)[])
    .filter((name) => !SETTINGS[name].key.startsWith(DIRECTOR_KEY_PREFIX))
    .map(settingField)
}

export function formatSettingInput(kind: SettingKind, value: unknown): string {
  if (kind === 'list') return Array.isArray(value) ? value.join('\n') : ''
  return String(value ?? '')
}

export type ParsedSetting = { ok: true; value: unknown } | { ok: false; error: string }

function candidateValue(kind: SettingKind, key: string, raw: string): unknown {
  if (kind === 'enum') return raw.trim()
  if (kind === 'boolean') {
    const text = raw.trim()
    return text === 'true' ? true : text === 'false' ? false : text
  }
  if (kind === 'list') {
    const separator = key === 'youtube_search_queries' ? /\n/ : /[\n,]/
    return raw
      .split(separator)
      .map((line) => line.trim())
      .filter(Boolean)
  }
  const text = raw.trim()
  return text === '' ? Number.NaN : Number(text)
}

export function parseSettingInput(
  field: Pick<SettingField, 'kind'> & { def: Pick<SettingDef<unknown>, 'key' | 'schema'> },
  raw: unknown,
): ParsedSetting {
  if (typeof raw !== 'string') return { ok: false, error: 'value is required' }
  const parsed = field.def.schema.safeParse(candidateValue(field.kind, field.def.key, raw))
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, error: issue ? issue.message : 'invalid value' }
}
