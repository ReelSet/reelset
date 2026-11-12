import {
  DIRECTOR_LONG_PROMPT_TOKENS,
  DIRECTOR_SKILLS_MAX_CHARS,
  DIRECTOR_SKILL_KINDS,
  DIRECTOR_SKILL_NAME_MAX_CHARS,
  SETTINGS,
  approxTokens,
  claudeCostUsd,
  claudeModelSchema,
  settingEnumOptions,
  type DirectorMeta,
  type SettingDef,
} from '@reelset/core'
import { z } from 'zod'

export const DIRECTOR_SETTING_NAMES = [
  'directorEnabled',
  'directorModel',
  'directorEffort',
  'directorReview',
  'directorMaxTokens',
  'directorRules',
  'directorReviewPrompt',
] as const satisfies readonly (keyof typeof SETTINGS)[]
export type DirectorSettingName = (typeof DIRECTOR_SETTING_NAMES)[number]

export type DirectorSettingKind = 'boolean' | 'enum' | 'number' | 'text'

export type DirectorSettingField = {
  name: DirectorSettingName
  def: SettingDef<unknown>
  kind: DirectorSettingKind
  label: string
  hint: string
  options: readonly string[]
}

const COPY: Record<DirectorSettingName, { label: string; hint: string }> = {
  directorEnabled: {
    label: 'Enabled',
    hint: 'Off: the box draws reels with its built-in non-AI renderer',
  },
  directorModel: { label: 'Model', hint: 'Writes the scene code and reviews the frames' },
  directorEffort: { label: 'Effort', hint: 'Thinking depth; higher costs more output tokens' },
  directorReview: {
    label: 'Self-review',
    hint: 'One extra pass: the model sees rendered frames and returns a corrected script',
  },
  directorMaxTokens: { label: 'Max output tokens', hint: '1024 to 128000 per model call' },
  directorRules: {
    label: 'Rules (main system prompt)',
    hint: 'House style and instructions, 200 to 20000 characters. Skills are appended after it.',
  },
  directorReviewPrompt: {
    label: 'Review prompt',
    hint: 'Sent with the rendered frames, 50 to 6000 characters. Ask for the complete script back.',
  },
}

function kindOf(def: SettingDef<unknown>): DirectorSettingKind {
  if (typeof def.default === 'boolean') return 'boolean'
  if (settingEnumOptions(def)) return 'enum'
  return typeof def.default === 'number' ? 'number' : 'text'
}

export function directorSettingFields(): DirectorSettingField[] {
  return DIRECTOR_SETTING_NAMES.map((name) => {
    const def = SETTINGS[name] as SettingDef<unknown>
    return { name, def, kind: kindOf(def), options: settingEnumOptions(def) ?? [], ...COPY[name] }
  })
}

export function isDirectorSettingName(name: unknown): name is DirectorSettingName {
  return DIRECTOR_SETTING_NAMES.some((n) => n === name)
}

export type ParsedInput<T> = { ok: true; value: T } | { ok: false; error: string }

function candidate(kind: DirectorSettingKind, raw: string): unknown {
  if (kind === 'boolean') return raw.trim() === 'true' ? true : raw.trim() === 'false' ? false : raw
  if (kind === 'number') return raw.trim() === '' ? Number.NaN : Number(raw.trim())
  if (kind === 'enum') return raw.trim()
  return raw.replace(/\r\n/g, '\n').trim()
}

export function parseDirectorSetting(name: unknown, raw: unknown): ParsedInput<unknown> {
  if (!isDirectorSettingName(name)) return { ok: false, error: 'Unknown director setting' }
  if (typeof raw !== 'string') return { ok: false, error: 'value is required' }
  const field = directorSettingFields().find((f) => f.name === name)!
  const parsed = field.def.schema.safeParse(candidate(field.kind, raw))
  if (parsed.success) return { ok: true, value: parsed.data }
  return { ok: false, error: `${field.def.key}: ${parsed.error.issues[0]?.message ?? 'invalid'}` }
}

export const skillFormSchema = z.object({
  name: z.string().trim().min(1).max(DIRECTOR_SKILL_NAME_MAX_CHARS),
  kind: z.enum(DIRECTOR_SKILL_KINDS),
  content: z
    .string()
    .transform((text) => text.replace(/\r\n/g, '\n'))
    .pipe(z.string().trim().min(1).max(DIRECTOR_SKILLS_MAX_CHARS)),
})
export type SkillForm = z.infer<typeof skillFormSchema>

export function parseSkillForm(raw: {
  name: unknown
  kind: unknown
  content: unknown
}): ParsedInput<SkillForm> {
  const parsed = skillFormSchema.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return {
    ok: false,
    error: `${String(issue?.path[0] ?? 'skill')}: ${issue?.message ?? 'invalid'}`,
  }
}

export type SkillSize = { kind: string; enabled: boolean; chars: number }

export type PromptBudget = {
  skillChars: number
  totalChars: number
  tokens: number
  overLongPromptTier: boolean
  overSkillLimit: boolean
}

/** Rough size of the director prompt: rules + enabled skills + the first enabled example. */
export function promptBudget(rulesChars: number, skills: readonly SkillSize[]): PromptBudget {
  const enabled = skills.filter((s) => s.enabled)
  const skillChars = enabled.filter((s) => s.kind === 'skill').reduce((n, s) => n + s.chars, 0)
  const exampleChars = enabled.find((s) => s.kind === 'example')?.chars ?? 0
  const totalChars = rulesChars + skillChars + exampleChars
  const tokens = approxTokens(totalChars)
  return {
    skillChars,
    totalChars,
    tokens,
    overLongPromptTier: tokens > DIRECTOR_LONG_PROMPT_TOKENS,
    overSkillLimit: skillChars > DIRECTOR_SKILLS_MAX_CHARS,
  }
}

export function fmtKb(chars: number): string {
  return `${(chars / 1024).toFixed(chars < 10_240 ? 1 : 0)} KB`
}

export function fmtTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens)
}

/** List-price cost of a director run, or null when the model is not in the price table. */
export function directorRunCostUsd(meta: DirectorMeta): number | null {
  const model = claudeModelSchema.safeParse(meta.model)
  return model.success ? claudeCostUsd(model.data, meta) : null
}
