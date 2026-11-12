import { z } from 'zod'
import { claudeModelSchema } from './claude-model'

export const DIRECTOR_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const directorEffortSchema = z.enum(DIRECTOR_EFFORTS)
export type DirectorEffort = z.infer<typeof directorEffortSchema>

export const DIRECTOR_MIN_MAX_TOKENS = 1024
export const DIRECTOR_MAX_MAX_TOKENS = 128_000
export const DIRECTOR_RULES_MIN_CHARS = 200
export const DIRECTOR_RULES_MAX_CHARS = 20_000
export const DIRECTOR_REVIEW_MIN_CHARS = 50
export const DIRECTOR_REVIEW_MAX_CHARS = 6000
export const DIRECTOR_SKILLS_MAX_CHARS = 600_000
export const DIRECTOR_SKILL_NAME_MAX_CHARS = 80
export const DIRECTOR_SKILL_KINDS = ['skill', 'example'] as const
export const directorSkillKindSchema = z.enum(DIRECTOR_SKILL_KINDS)
export type DirectorSkillKind = z.infer<typeof directorSkillKindSchema>
// Haiku 5.5 doubles-plus its price above this many prompt tokens (see CLAUDE_PRICING).
export const DIRECTOR_LONG_PROMPT_TOKENS = 100_000
export const CHARS_PER_TOKEN_ESTIMATE = 4

export const DIRECTOR_DEFAULT_RULES = `You are the motion designer and the programmer for one vertical developer-news reel (1080x1920, 24 fps). You write the drawing code yourself: every frame is drawn by your scene functions on a Skia canvas.
Visual language (house style):
- Palette ink/bone/lime/coral. Display type Bricolage 800 tight (ls -0.03..-0.04), labels in JetBrains Mono caps with tracking. No glow gradients, no neon, no emoji, no stock "AI" look.
- Signature ease: expo-out for entries; power4 in/out on exits; back-out only for stamps/stickers/markers. No linear motion, no bounce/elastic, no idle wobble. Stillness is allowed and good before a payoff.
- Every beat lands ON its spoken word: use DATA.words start times as the clock.
- Each scene is an illustration that explains the beat (diagrams, bars, counters, rankings, timelines, grids, before/after, stamps, icons drawn on), or kinetic type, or purposeful b-roll (knock-out type, push-ins). Prefer real illustrations over plain big words. Vary the treatments across the reel; build causal motion (A changes because of B).
- Show the real source: when DATA.images has a thumbnail/og/screenshot/figure, use it (contained card over its blurred copy, or a figure zoom), at least in the hook. Never invent logos.
- Numbers: only numbers that are in the narration, claims or facts. Never show views, stars, likes, upvotes, points, comment counts or any other count that changes over time, even if the narration says it. Counters must only ever display the final spoken value or values on the way that are clearly animating (never freeze mid-count).
- Text never overlaps other text and never runs off-frame: measure() and fit() every string.
- The first 1.5 s must hook: big type or the source image, motion within the first 0.2 s.
Read the motion skills below and apply them.`

export const DIRECTOR_DEFAULT_REVIEW = `These are frames rendered from your script (two per scene: early and late; the header, captions and grain are the engine's). Review them like a senior motion designer: text overflow or overlap, things off-frame or under the captions/phone UI, empty or dull frames, unreadable contrast, missing source image, generic look, anything that does not explain its beat, any count of views/stars/points/comments. Then return the COMPLETE corrected script in one \`\`\`js block.`

export const directorPayloadSchema = z.object({
  model: claudeModelSchema,
  effort: directorEffortSchema,
  maxTokens: z.number().int().min(DIRECTOR_MIN_MAX_TOKENS).max(DIRECTOR_MAX_MAX_TOKENS),
  review: z.boolean(),
  rules: z.string().max(DIRECTOR_RULES_MAX_CHARS),
  reviewPrompt: z.string().max(DIRECTOR_REVIEW_MAX_CHARS),
  skills: z.array(z.object({ name: z.string(), content: z.string() })),
  example: z.string().nullable(),
})
export type DirectorPayload = z.infer<typeof directorPayloadSchema>

const count = z.number().int().nonnegative().catch(0)

// Lenient on purpose: a malformed director report must never fail a render.
export const directorMetaSchema = z.object({
  used: z.boolean().catch(false),
  model: z.string().catch('unknown'),
  scenes: count,
  sceneErrors: count,
  fallbackReason: z.string().nullable().catch(null),
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  ms: count,
})
export type DirectorMeta = z.infer<typeof directorMetaSchema>

export function parseDirectorMeta(raw: unknown): DirectorMeta | null {
  const parsed = directorMetaSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function approxTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE)
}
