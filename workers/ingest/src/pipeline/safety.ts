import type { ReelScript } from '@reelset/core'

const BLOCKLIST = [
  'fuck',
  'fucking',
  'shit',
  'bitch',
  'bastard',
  'asshole',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'retarded',
  'kike',
  'spic',
  'chink',
  'tranny',
]
const BLOCK_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BLOCKLIST.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
const URL_RE = /https?:\/\/[^\s<>"'`\\)\]}]+/gi

export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?*_]+$/, ''))
}

function normalizeForMatch(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '')
}

export function scriptTexts(script: ReelScript): string[] {
  const texts = [script.hook, script.outro]
  for (const beat of script.beats) {
    texts.push(beat.text)
    const v = beat.visual
    switch (v.type) {
      case 'title':
        texts.push(v.title, v.subtitle ?? '')
        break
      case 'code':
        texts.push(v.code)
        break
      case 'stat':
        texts.push(v.label, v.value)
        break
      case 'quote':
        texts.push(v.text, v.attribution)
        break
      case 'image':
        break
    }
  }
  for (const claim of script.claims) texts.push(claim.text)
  return texts.filter(Boolean)
}

export type GeneratedContent = {
  tldr: string
  topics: string[]
  script: ReelScript
}

export type ValidationInput = GeneratedContent & {
  sourceText: string
  chunkIds: ReadonlySet<string>
  allowedImageUrls: ReadonlySet<string>
}

export type ValidationResult = { ok: true } | { ok: false; reasons: string[] }

export function validateGenerated(input: ValidationInput): ValidationResult {
  const reasons: string[] = []
  const texts = [input.tldr, ...input.topics, ...scriptTexts(input.script)]
  const sourceLower = input.sourceText.toLowerCase()

  const foreignUrls = new Set<string>()
  for (const text of texts) {
    for (const url of extractUrls(text)) {
      if (!sourceLower.includes(normalizeForMatch(url))) foreignUrls.add(url)
    }
  }
  for (const url of foreignUrls) reasons.push(`url not present in the source text: ${url}`)

  for (const text of texts) {
    const hit = BLOCK_RE.exec(text)
    if (hit) {
      reasons.push(`contains a blocked word: "${hit[0].toLowerCase()}"`)
      break
    }
  }

  if (input.script.claims.length === 0) reasons.push('script has no claims citing evidence chunks')
  for (const claim of input.script.claims) {
    const unknown = claim.chunkIds.filter((id) => !input.chunkIds.has(id))
    if (unknown.length > 0) {
      reasons.push(`claim cites chunk ids that do not belong to this item: ${unknown.join(', ')}`)
    }
  }

  for (const beat of input.script.beats) {
    if (beat.visual.type !== 'image') continue
    if (!input.allowedImageUrls.has(normalizeForMatch(beat.visual.url))) {
      reasons.push(`image url is not from this item's own sources: ${beat.visual.url}`)
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s]*)?$/i

export function extractImageUrls(text: string): string[] {
  const urls = new Set<string>()
  for (const m of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/gi)) urls.add(m[1] ?? '')
  for (const m of text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    urls.add(m[1] ?? '')
  }
  for (const url of extractUrls(text)) if (IMAGE_EXT.test(url)) urls.add(url)
  return [...urls].filter(Boolean)
}

export function allowedImageSet(
  mentions: readonly { source: string; externalId: string }[],
  texts: readonly string[],
): Set<string> {
  const allowed = new Set<string>()
  for (const text of texts)
    for (const url of extractImageUrls(text)) allowed.add(normalizeForMatch(url))
  for (const m of mentions) {
    if (m.source === 'youtube') {
      allowed.add(normalizeForMatch(`https://i.ytimg.com/vi/${m.externalId}/hqdefault.jpg`))
    }
  }
  return allowed
}
