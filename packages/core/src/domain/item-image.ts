import { z } from 'zod'

export const ITEM_IMAGE_KINDS = ['og', 'thumbnail', 'figure', 'screenshot', 'avatar'] as const
export const MAX_ITEM_IMAGES = 6

export const itemImageSchema = z.object({
  url: z.url().max(2048),
  kind: z.enum(ITEM_IMAGE_KINDS),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  alt: z.string().max(300).optional(),
  caption: z.string().max(60).optional(),
  /** Words and numbers readable in the image, transcribed by the vetting model. */
  text: z.string().max(400).optional(),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  role: z.enum(['hero', 'figure', 'screenshot', 'logo', 'junk']).optional(),
})

export type ItemImage = z.infer<typeof itemImageSchema>
export type ItemImageKind = ItemImage['kind']

/** Tolerant read of item.images: invalid entries are dropped, never thrown on. */
export function parseItemImages(value: unknown): ItemImage[] {
  if (!Array.isArray(value)) return []
  const out: ItemImage[] = []
  for (const entry of value) {
    const parsed = itemImageSchema.safeParse(entry)
    if (parsed.success && parsed.data.url.startsWith('https://')) out.push(parsed.data)
    if (out.length >= MAX_ITEM_IMAGES) break
  }
  return out
}
