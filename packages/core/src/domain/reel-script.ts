import { z } from 'zod'

export const REEL_SCRIPT_VERSION = 1

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
  beats: z
    .array(z.object({ text: z.string().min(1).max(220), visual: visualSchema }))
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
