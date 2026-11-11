import Anthropic from '@anthropic-ai/sdk'
import { errorFields, type Database, type ItemImage, type Logger } from '@reelset/core'
import { z } from 'zod'
import { asClaudeQuotaError, imageBlock, parseClaudeMessage, type ClaudeMessage } from './claude'
import type { LlmImage, LlmUsage } from './output'
import { QuotaExhaustedError } from './quota'

export const MAX_VET_IMAGES = 6
export const MAX_VET_BYTES = 3.5 * 1024 * 1024
export const VET_COST_CAP_USD = 0.004
// claude-haiku-5-5: $0.10 / $0.50 per 1M tokens. An image is up to ~1600 input tokens plus the
// prompt, the answer (with a short think) ~300.
const COST_PER_IMAGE_USD = (2000 * 0.1 + 300 * 0.5) / 1_000_000
// v2: verdicts from the Claude prompt, which also transcribes text; older Gemini verdicts lack it.
const CACHE_PREFIX = 'img_vet:v2:'
const VET_MAX_TOKENS = 2000
const VET_TIMEOUT_MS = 30_000

export const VET_PROMPT = `You vet one image that may appear in a short vertical video about a developer topic (a GitHub repo, a paper, an article, a thread).
Return JSON only: {"keep": boolean, "reason": string (max 80 chars), "role": "hero"|"figure"|"screenshot"|"logo"|"junk", "caption": string (max 60 chars, plain words describing what it shows, no quotes), "text": string (max 400 chars), "focus": {"x": number 0-1, "y": number 0-1}}.
- keep=false for junk: ads, tracking pixels, badges, blank or near-blank images, avatars, stock-photo filler, cookie banners, 404 pages, tiny icons.
- role "logo" for brand marks and wordmarks (keep=false unless it is the only visual of the topic).
- role "figure" for charts, diagrams, architecture drawings, result plots; "screenshot" for UI or terminal captures; "hero" for a clear title image, social preview or photo of the subject.
- text: the important words and numbers readable in the image, copied exactly (headline, chart labels with their values, the key lines of a screenshot, the joke of a meme). Empty string when there is no readable text.
- focus is the most informative point of the image (where a slow zoom should aim).`

export const vetSchema = z.object({
  keep: z.boolean(),
  reason: z.string().max(200).default(''),
  role: z.enum(['hero', 'figure', 'screenshot', 'logo', 'junk']),
  caption: z.string().max(200).default(''),
  text: z.string().max(2000).default(''),
  focus: z.object({ x: z.number(), y: z.number() }).default({ x: 0.5, y: 0.5 }),
})
export type VetResult = z.infer<typeof vetSchema>

export type VetCache = {
  get(hash: string): Promise<VetResult | null>
  set(hash: string, result: VetResult): Promise<void>
}

export type VetDeps = {
  /** Sends the image and the prompt to the model; throws QuotaExhaustedError when credits are gone. */
  ask: (image: LlmImage) => Promise<{ text: string; usage?: LlmUsage }>
  download: (url: string) => Promise<LlmImage | null>
  cache: VetCache
  log: Logger
  costCapUsd?: number
}

export type VetOptions = {
  /**
   * The images are the item's own content (a Reddit post's picture): annotate them but never drop
   * them, since a meme or screenshot is the subject even when it looks like filler.
   */
  keepAll?: boolean
}

export async function urlHash(url: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return [...new Uint8Array(buf)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function normalizeVet(raw: unknown): VetResult | null {
  const parsed = vetSchema.safeParse(raw)
  if (!parsed.success) return null
  const v = parsed.data
  const caption = v.caption.replace(/\s+/g, ' ').trim().slice(0, 60).trim()
  const text = v.text.replace(/\s+/g, ' ').trim().slice(0, 400).trim()
  return {
    ...v,
    reason: v.reason.slice(0, 80),
    caption,
    text,
    focus: { x: clamp01(v.focus.x), y: clamp01(v.focus.y) },
  }
}

function parseAnswer(text: string): VetResult | null {
  try {
    return normalizeVet(JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim()))
  } catch {
    return null
  }
}

/** Applies a verdict: junk, logos and keep=false are dropped; caption, role, text and focus ride on the image. */
export function applyVerdict(image: ItemImage, v: VetResult, keepAll = false): ItemImage | null {
  const drop = !v.keep || v.role === 'junk' || v.role === 'logo'
  if (drop && !keepAll) return null
  return {
    ...image,
    ...(drop ? {} : { role: v.role }),
    ...(v.caption ? { caption: v.caption } : {}),
    ...(v.text ? { text: v.text } : {}),
    focus: v.focus,
  }
}

/**
 * Asks the model about each candidate image (cached per URL hash, at most 6 images and a small cost
 * cap per item). Quota or billing errors, and any other failure, leave an image as it was: vetting
 * is an upgrade, never a gate. Never throws.
 */
export async function vetImages(
  images: readonly ItemImage[],
  deps: VetDeps,
  options: VetOptions = {},
): Promise<ItemImage[]> {
  const cap = deps.costCapUsd ?? VET_COST_CAP_USD
  let spent = 0
  let stopped = false
  const out: ItemImage[] = []
  let asked = 0
  for (const image of images) {
    if (image.kind === 'avatar' || asked >= MAX_VET_IMAGES) {
      out.push(image)
      continue
    }
    asked += 1
    const hash = await urlHash(image.url)
    let verdict = await deps.cache.get(hash).catch(() => null)
    if (!verdict && !stopped) {
      if (spent + COST_PER_IMAGE_USD > cap) {
        deps.log.info({ spent }, 'image vetting cost cap reached, rest kept as is')
        stopped = true
      } else {
        try {
          const file = await deps.download(image.url)
          if (file) {
            const res = await deps.ask(file)
            spent += COST_PER_IMAGE_USD
            verdict = parseAnswer(res.text)
            if (verdict) await deps.cache.set(hash, verdict).catch(() => undefined)
          }
        } catch (err) {
          if (err instanceof QuotaExhaustedError) {
            deps.log.warn({ status: err.status }, 'image vetting skipped: model quota exhausted')
            stopped = true
          } else {
            deps.log.warn({ url: image.url.slice(0, 80), ...errorFields(err) }, 'image vet failed')
          }
        }
      }
    }
    if (!verdict) {
      out.push(image)
      continue
    }
    const kept = applyVerdict(image, verdict, options.keepAll)
    if (kept) out.push(kept)
    else
      deps.log.info(
        { url: image.url.slice(0, 80), role: verdict.role, reason: verdict.reason },
        'image dropped by vetting',
      )
  }
  return out
}

export function createDbVetCache(db: Database): VetCache {
  return {
    async get(hash) {
      const row = await db
        .selectFrom('app_setting')
        .select('value')
        .where('key', '=', `${CACHE_PREFIX}${hash}`)
        .executeTakeFirst()
      return row ? normalizeVet(row.value) : null
    },
    async set(hash, result) {
      await db
        .insertInto('app_setting')
        .values({ key: `${CACHE_PREFIX}${hash}`, value: JSON.stringify(result) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(result) }))
        .execute()
    },
  }
}

export async function downloadForVet(url: string): Promise<LlmImage | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!res.ok || !/^image\/(?:png|jpe?g|webp|gif)$/.test(mime)) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VET_BYTES) return null
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mime, base64: btoa(binary) }
}

/** Image vetting on Claude (Haiku): one image plus the vet prompt, low effort, JSON back. */
export function createClaudeVetter(
  apiKey: string,
  model: string,
  log: Logger,
  options: { fetch?: typeof fetch } = {},
) {
  const client = new Anthropic({
    apiKey,
    maxRetries: 1,
    timeout: VET_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  return async (image: LlmImage): Promise<{ text: string; usage?: LlmUsage }> => {
    const block = imageBlock(image)
    if (!block) throw new Error(`image type not supported for vetting: ${image.mime}`)
    try {
      const message = await client.messages.create({
        model,
        max_tokens: VET_MAX_TOKENS,
        messages: [{ role: 'user', content: [block, { type: 'text', text: VET_PROMPT }] }],
        output_config: { effort: 'low' },
      })
      return parseClaudeMessage(message as unknown as ClaudeMessage)
    } catch (err) {
      const mapped = asClaudeQuotaError(err)
      if (!(mapped instanceof QuotaExhaustedError))
        log.warn({ model, ...errorFields(mapped) }, 'claude image vet call failed')
      throw mapped
    }
  }
}
