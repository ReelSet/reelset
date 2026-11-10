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

export type DemoBox = {
  left: number
  top: number
  width: number
  height: number
  fullBleed: boolean
}

/** Side margin of a landscape demo: the whole clip stays visible, with room for a gentle push-in. */
export const DEMO_MARGIN = 24

/**
 * Where the README demo plays: portrait clips go full-bleed; landscape and square clips are shown
 * whole (never cropped: README UIs have text at the edges), as wide as the frame allows, centred in
 * the zone between the top chrome and the captions so no caption ever sits on the clip.
 */
export function demoBox(
  iw: number,
  ih: number,
  contentTop: number,
  w = 1080,
  h = 1920,
  zoneBottom = Math.round(h * 0.58) - 24,
): DemoBox {
  if (ih > iw * 1.1) return { left: 0, top: 0, width: w, height: h, fullBleed: true }
  const zone = Math.max(1, zoneBottom - contentTop)
  let width = w - 2 * DEMO_MARGIN
  let height = Math.round((width * ih) / iw)
  if (height > zone) {
    height = zone
    width = Math.round((height * iw) / ih)
  }
  return {
    left: Math.round((w - width) / 2),
    top: contentTop + Math.round((zone - height) / 2),
    width,
    height,
    fullBleed: false,
  }
}
