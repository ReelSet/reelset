import { errorFields, type Database, type ItemImage, type Logger } from '@reelset/core'
import { z } from 'zod'
import { fetchJson } from '../http'
import { parseGenerateResponse, type LlmUsage } from './gemini'
import { QuotaExhaustedError, asQuotaError } from './quota'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const MAX_VET_IMAGES = 6
export const MAX_VET_BYTES = 4 * 1024 * 1024
export const VET_COST_CAP_USD = 0.004
// gemini-3.1-flash-lite: $0.25 / $1.5 per 1M tokens. An image is ~1100 input tokens, the answer ~80.
const COST_PER_IMAGE_USD = (1100 * 0.25 + 80 * 1.5) / 1_000_000
const CACHE_PREFIX = 'img_vet:'

export const VET_PROMPT = `You vet one image that may appear in a short vertical video about a developer topic (a GitHub repo, a paper, an article, a thread).
Return JSON only: {"keep": boolean, "reason": string (max 80 chars), "role": "hero"|"figure"|"screenshot"|"logo"|"junk", "caption": string (max 60 chars, plain words describing what it shows, no quotes), "focus": {"x": number 0-1, "y": number 0-1}}.
- keep=false for junk: ads, tracking pixels, badges, blank or near-blank images, avatars, stock-photo filler, cookie banners, 404 pages, tiny icons.
- role "logo" for brand marks and wordmarks (keep=false unless it is the only visual of the topic).
- role "figure" for charts, diagrams, architecture drawings, result plots; "screenshot" for UI or terminal captures; "hero" for a clear title image, social preview or photo of the subject.
- focus is the most informative point of the image (where a slow zoom should aim).`

export const vetSchema = z.object({
  keep: z.boolean(),
  reason: z.string().max(200).default(''),
  role: z.enum(['hero', 'figure', 'screenshot', 'logo', 'junk']),
  caption: z.string().max(200).default(''),
  focus: z.object({ x: z.number(), y: z.number() }).default({ x: 0.5, y: 0.5 }),
})
export type VetResult = z.infer<typeof vetSchema>

export type VetCache = {
  get(hash: string): Promise<VetResult | null>
  set(hash: string, result: VetResult): Promise<void>
}

export type VetDeps = {
  /** Sends the image and the prompt to the model; throws QuotaExhaustedError when credits are gone. */
  ask: (image: { mime: string; base64: string }) => Promise<{ text: string; usage?: LlmUsage }>
  download: (url: string) => Promise<{ mime: string; base64: string } | null>
  cache: VetCache
  log: Logger
  costCapUsd?: number
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
  return {
    ...v,
    reason: v.reason.slice(0, 80),
    caption,
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

/** Applies a verdict: junk, logos and keep=false are dropped; caption, role and focus ride on the image. */
export function applyVerdict(image: ItemImage, v: VetResult): ItemImage | null {
  if (!v.keep || v.role === 'junk' || v.role === 'logo') return null
  return {
    ...image,
    role: v.role,
    ...(v.caption ? { caption: v.caption } : {}),
    focus: v.focus,
  }
}

/**
 * Asks the model about each candidate image (cached per URL hash, at most 6 images and a small cost
 * cap per item). Quota or billing errors, and any other failure, leave an image as it was: vetting
 * is an upgrade, never a gate. Never throws.
 */
export async function vetImages(images: readonly ItemImage[], deps: VetDeps): Promise<ItemImage[]> {
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
    const kept = applyVerdict(image, verdict)
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

export async function downloadForVet(
  url: string,
): Promise<{ mime: string; base64: string } | null> {
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

export function createGeminiVetter(apiKey: string, model: string, log: Logger) {
  return async (image: { mime: string; base64: string }) => {
    try {
      const json = await fetchJson(`${BASE}/models/${model}:generateContent`, log, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: VET_PROMPT },
                { inlineData: { mimeType: image.mime, data: image.base64 } },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
        timeoutMs: 30_000,
        attempts: 1,
        hostIntervalMs: 0,
      })
      const result = parseGenerateResponse(json)
      return { text: result.text, usage: result.usage }
    } catch (err) {
      throw asQuotaError(err)
    }
  }
}
