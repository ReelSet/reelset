import type { Reel } from '../plan'
import { API_DOC } from './api-doc'
import type { DirectorConfig } from './config'

const EXAMPLE_NOTE =
  'A hand-made reel about a different item (Gemini 4 Carbon pricing), written against this same kit (its imports are your globals; gemini() and iconPart() are not available to you). Learn the craft from it; do not copy its content.'

/** The reel data the model sees as DATA (narration, word clock, claims, images, stock clips). */
export function dataOf(reel: Reel) {
  const p = reel.props
  return {
    title: p.title,
    source: p.source,
    sourceLabel: p.sourceLabel,
    domain: p.domain,
    headline: p.headline ?? null,
    duration: +p.durationSeconds.toFixed(2),
    narration: p.scenes.map((s) => ({
      kind: s.kind,
      start: +s.start.toFixed(2),
      end: +s.end.toFixed(2),
      text: s.text,
    })),
    words: p.words.map((w) => [w.text, +w.start.toFixed(2)]),
    claims: p.claims ?? [],
    facts: p.facts ?? {},
    images: (p.images ?? []).map((im, i) => ({
      index: i,
      kind: im.kind,
      width: im.width,
      height: im.height,
      about: im.caption ?? im.alt ?? '',
      focus: im.focus ?? null,
    })),
    broll: (p.broll ?? []).map((b, i) => ({
      index: i,
      seconds: b.seconds,
      about:
        (b.pageUrl ?? '')
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replace(/-\d+$/, '')
          .replace(/-/g, ' ') ?? '',
    })),
  }
}

export type ReelData = ReturnType<typeof dataOf>

const skillBlock = (s: { name: string; content: string }) =>
  `<skill name="${s.name.replace(/"/g, "'")}">\n${s.content}\n</skill>`

/** The cached system prompt: rules, runtime API, icons, the example reel and the skills. */
export function systemText(config: DirectorConfig, iconNames: string[]): string {
  const parts = [config.rules, API_DOC, `Available icons: ${iconNames.join(', ')}`]
  if (config.example)
    parts.push(`<example_scenes note="${EXAMPLE_NOTE}">\n${config.example}\n</example_scenes>`)
  if (config.skills.length)
    parts.push(`<motion_skills>\n${config.skills.map(skillBlock).join('\n\n')}\n</motion_skills>`)
  return parts.join('\n')
}

export const briefOf = (data: ReelData): string =>
  `Here is the reel. Write the complete scene script.\n\nDATA = ${JSON.stringify(data)}`

export type ReviewNotes = { loadError: string | null; sceneErrors: string[]; hasSheet: boolean }

/** The review turn's text: the admin-configured prompt plus what the renderer found wrong. */
export function reviewText(config: DirectorConfig, notes: ReviewNotes): string {
  const parts = [config.reviewPrompt.trim()]
  if (notes.loadError)
    parts.push(
      `Your script FAILED TO LOAD (${notes.loadError})${notes.hasSheet ? '' : ', so there are no frames'}. Fix the error.`,
    )
  if (notes.sceneErrors.length)
    parts.push(
      `Runtime errors (the scene fell back to a placeholder):\n${notes.sceneErrors.map((e) => `- ${e}`).join('\n')}`,
    )
  return parts.join('\n\n')
}
