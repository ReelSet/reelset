export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** The director block of the POST /render request, as written to director.json by the Python side. */
export type DirectorConfig = {
  model: string
  effort: Effort
  maxTokens: number
  review: boolean
  rules: string
  reviewPrompt: string
  skills: { name: string; content: string }[]
  example: string | null
}

export const FALLBACK_REASONS = [
  'no_api_key',
  'api_error',
  'load_error',
  'crash',
  'timeout',
] as const
export type FallbackReason = (typeof FALLBACK_REASONS)[number]

/** The render metadata the box returns under `director` (director-result.json). */
export type DirectorResult = {
  used: boolean
  model: string
  scenes: number
  sceneErrors: number
  fallbackReason: FallbackReason | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  ms: number
}

export type Usage = Pick<
  DirectorResult,
  'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
>

export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** What the drawing child reports back about a scripted render. */
export type DrawReport = {
  loadError: string | null
  scenes: number
  sceneErrors: { scene: number; message: string }[]
}

export const EXIT_LOAD_ERROR = 3
export const REPORT_FILE = 'draw-report.json'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validates director.json (already validated by Python); returns null when it is not usable. */
export function parseDirectorConfig(raw: unknown): DirectorConfig | null {
  if (!isObject(raw)) return null
  const { model, effort, maxTokens, review, rules, reviewPrompt, skills, example } = raw
  if (typeof model !== 'string' || !model) return null
  if (!EFFORTS.includes(effort as Effort)) return null
  if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1) return null
  if (typeof rules !== 'string' || typeof reviewPrompt !== 'string') return null
  const cleanSkills = (Array.isArray(skills) ? skills : []).filter(
    (s): s is { name: string; content: string } =>
      isObject(s) && typeof s.name === 'string' && typeof s.content === 'string',
  )
  return {
    model,
    effort: effort as Effort,
    maxTokens,
    review: review === true,
    rules,
    reviewPrompt,
    skills: cleanSkills,
    example: typeof example === 'string' && example ? example : null,
  }
}
