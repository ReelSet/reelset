import { z } from 'zod'

export const REEL_SCRIPT_VERSION = 1

export const SCREEN_NAMES = [
  'RepoPage',
  'Terminal',
  'CodeBlock',
  'StatSlam',
  'BarRace',
  'HNThread',
  'RedditPost',
  'YouTubePlayer',
  'PaperPage',
  'FigureZoom',
  'TableScreen',
  'EquationScreen',
  'ArticleHeadline',
  'ImageFull',
  'KeyPoint',
  'Compare',
  'EndCard',
  'RepoDemo',
] as const
export const SFX_NAMES = ['whoosh', 'pop', 'tick', 'ding', 'hit', 'riser', 'swoosh'] as const
export type ScreenName = (typeof SCREEN_NAMES)[number]
export type SfxName = (typeof SFX_NAMES)[number]

export const shotSchema = z.object({
  at: z.string().min(1).max(40),
  show: z.enum(SCREEN_NAMES),
  props: z.record(z.string().max(32), z.unknown()).optional(),
  sfx: z.enum(SFX_NAMES).optional(),
})
export type Shot = z.infer<typeof shotSchema>

const visualSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('title'),
    title: z.string().min(1).max(90),
    subtitle: z.string().max(120).optional(),
  }),
  z.object({
    type: z.literal('code'),
    language: z.string().min(1).max(24),
    code: z.string().min(1).max(600),
  }),
  z.object({
    type: z.literal('stat'),
    label: z.string().min(1).max(60),
    value: z.string().min(1).max(24),
  }),
  z.object({
    type: z.literal('quote'),
    text: z.string().min(1).max(220),
    attribution: z.string().min(1).max(80),
  }),
  z.object({ type: z.literal('image'), url: z.url() }),
])

export const reelScriptSchema = z.object({
  version: z.literal(REEL_SCRIPT_VERSION),
  hook: z.string().min(1).max(120),
  headline: z.string().min(1).max(60).optional(),
  beats: z
    .array(
      z.object({
        text: z.string().min(1).max(220),
        visual: visualSchema,
        shots: z.array(shotSchema).max(6).optional(),
        broll: z.array(z.string().min(2).max(40)).max(2).optional(),
        keyPoints: z.array(z.string().min(3).max(70)).max(2).optional(),
      }),
    )
    .min(2)
    .max(6),
  outro: z.string().min(1).max(120),
  claims: z.array(
    z.object({ text: z.string().min(1).max(220), chunkIds: z.array(z.uuid()).min(1) }),
  ),
})

export type ReelScript = z.infer<typeof reelScriptSchema>
export type ReelVisual = z.infer<typeof visualSchema>

export function narrationText(script: ReelScript): string {
  return [script.hook, ...script.beats.map((b) => b.text), script.outro].join(' ')
}
