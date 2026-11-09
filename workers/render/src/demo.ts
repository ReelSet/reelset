import { z } from 'zod'

export const demoSchema = z.object({
  url: z.url().max(2048),
  kind: z.enum(['gif', 'mp4', 'webm']),
  repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
})
export type ItemDemo = z.infer<typeof demoSchema>

/** item.demo is { url, kind, width?, height?, bytes? } captured at ingest; the repo comes from the canonical url. */
export function parseDemo(value: unknown, canonicalUrl: string): ItemDemo | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const repo = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/.exec(canonicalUrl)
  if (!repo) return undefined
  const parsed = demoSchema.safeParse({
    url: (value as { url?: unknown }).url,
    kind: (value as { kind?: unknown }).kind,
    repo: `${repo[1]}/${repo[2]}`,
  })
  return parsed.success && parsed.data.url.startsWith('https://') ? parsed.data : undefined
}
