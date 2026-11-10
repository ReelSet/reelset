import type { ReelImage, ReelProps, Scene } from './types'

export type ImageFit = { mode: 'cover' | 'contain'; width: number; height: number }

const MAX_UPSCALE = 1.15
const MAX_COVER_CROP = 0.3

/**
 * How to show an image in a w x h frame without blur. Fills the frame when the crop is small and the
 * upscale is mild; otherwise shows it whole at no more than 1.15x its pixels over a blurred backdrop.
 */
export function fitImage(iw: number, ih: number, w: number, h: number): ImageFit {
  const coverScale = Math.max(w / iw, h / ih)
  const imgAspect = iw / ih
  const frameAspect = w / h
  const crop = 1 - Math.min(imgAspect / frameAspect, frameAspect / imgAspect)
  if (coverScale <= MAX_UPSCALE && crop <= MAX_COVER_CROP) {
    return { mode: 'cover', width: iw * coverScale, height: ih * coverScale }
  }
  const scale = Math.min(w / iw, h / ih, MAX_UPSCALE)
  return { mode: 'contain', width: iw * scale, height: ih * scale }
}

const HERO_ORDER: ReelImage['kind'][] = ['thumbnail', 'og', 'screenshot', 'figure', 'avatar']
const FIGURE_ORDER: ReelImage['kind'][] = ['figure', 'screenshot', 'og', 'thumbnail', 'avatar']

function pick(images: ReelImage[], order: ReelImage['kind'][]): ReelImage[] {
  return [...images].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

export type ImagePlan = {
  hero: ReelImage | null
  /** scene index -> image for beats that show a source image instead of a drawn motif */
  beats: Map<number, ReelImage>
}

/**
 * Hero image goes in the hook; remaining images replace drawn motifs ('image' beats) and, when
 * there are leftovers, title beats, at most half the beats so motifs stay in the mix.
 */
export function planImages(props: Pick<ReelProps, 'images' | 'scenes'>): ImagePlan {
  const images = props.images ?? []
  if (images.length === 0) return { hero: null, beats: new Map() }
  const hero = pick(images, HERO_ORDER)[0]!
  const rest = pick(
    images.filter((i) => i !== hero),
    FIGURE_ORDER,
  )
  const beatIdx = props.scenes.flatMap((s: Scene, i) => (s.kind === 'beat' ? [i] : []))
  const budget = Math.max(1, Math.floor(beatIdx.length / 2))
  const slots = [
    ...beatIdx.filter(
      (i) => (props.scenes[i] as Extract<Scene, { kind: 'beat' }>).visual.type === 'image',
    ),
    ...beatIdx.filter(
      (i) => (props.scenes[i] as Extract<Scene, { kind: 'beat' }>).visual.type === 'title',
    ),
  ].slice(0, budget)
  const beats = new Map<number, ReelImage>()
  slots
    .sort((a, b) => a - b)
    .forEach((slot, n) => {
      const img = rest[n]
      if (img) beats.set(slot, img)
    })
  return { hero, beats }
}

const contentWords = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  )

/**
 * A site's default share card ("MailRoute — Cloud Email Security"): an og image whose alt names the
 * site and shares at most one word with the story's title. It says nothing about the story, so it
 * is never shown.
 */
export function isBrandImage(image: ReelImage, title: string, domain: string): boolean {
  if (image.kind !== 'og' || !image.alt?.trim()) return false
  const stem =
    domain
      .replace(/^www\./, '')
      .split('.')[0]
      ?.toLowerCase() ?? ''
  const alt = [...contentWords(image.alt)]
  const brand = stem.length >= 3 && alt.some((w) => w.includes(stem))
  const titleWords = contentWords(title)
  const shared = alt.filter((w) => !w.includes(stem) && titleWords.has(w)).length
  return brand && shared <= 1
}

/** Short source caption: "Figure 2" from a paper caption, else the domain. */
export function captionFor(image: ReelImage, domain: string): string {
  const vetted = image.caption?.trim()
  if (vetted) return vetted.length > 60 ? `${vetted.slice(0, 59).trimEnd()}…` : vetted
  const m = /^\s*fig(?:ure|\.)?\s*(\d+[a-z]?)/i.exec(image.alt ?? '')
  if (m) return `Figure ${m[1]}`
  if (image.kind === 'figure') return `Figure · ${domain}`
  return domain
}

/** CSS transform origin for the Ken Burns zoom: the vetted point of interest, else the fallback. */
export function focusOrigin(image: ReelImage | undefined, fallback: string): string {
  const f = image?.focus
  if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y)) return fallback
  const pct = (n: number) => Math.round(Math.min(0.9, Math.max(0.1, n)) * 100)
  return `${pct(f.x)}% ${pct(f.y)}%`
}

export type DemoCrop = {
  top: number
  height: number
  videoWidth: number
  videoHeight: number
  /** Horizontal px of the scaled clip outside the window. */
  overflow: number
  /** Pan start and end as shares of `overflow` (0 = left edge in view). */
  panFrom: number
  panTo: number
}

/** A demo is never zoomed past this share of its width: more crops the UI's own headings. */
export const DEMO_MIN_SHARE = 0.72

/**
 * Window for a README demo between `top` and `bottom` (above the caption band): the clip fills the
 * frame width and is scaled up as far as the room allows, but always shows at least 72% of its
 * width, panning gently across the rest; the window is centred in the room and never taller than
 * the clip. A portrait clip fills the width.
 */
export function demoCrop(iw: number, ih: number, top: number, bottom: number, w = 1080): DemoCrop {
  const room = Math.max(1, Math.min(bottom - top, Math.round(w * 1.25)))
  const fill = w / iw
  const scale = Math.max(fill, Math.min(room / ih, w / (iw * DEMO_MIN_SHARE)))
  const videoWidth = Math.round(iw * scale)
  const videoHeight = Math.round(ih * scale)
  const height = Math.min(room, videoHeight)
  const overflow = Math.max(0, videoWidth - w)
  return {
    top: top + Math.round((room - height) / 2),
    height,
    videoWidth,
    videoHeight,
    overflow,
    panFrom: 0.1,
    panTo: 0.9,
  }
}
