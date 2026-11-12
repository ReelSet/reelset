import { describe, expect, it } from 'vitest'
import {
  MAX_FIGURE_ZOOM,
  captionFor,
  fitImage,
  isBrandImage,
  planImages,
  wideFigureZoom,
} from './images'
import type { ReelImage, Scene } from './types'

describe('fitImage', () => {
  it('fills the frame when crop and upscale are small', () => {
    const fit = fitImage(1280, 720, 564, 330)
    expect(fit.mode).toBe('cover')
    expect(fit.width).toBeGreaterThanOrEqual(564)
    expect(fit.height).toBeGreaterThanOrEqual(330)
  })

  it('never upscales a small image past 1.15x: shows it contained', () => {
    const fit = fitImage(300, 200, 564, 330)
    expect(fit.mode).toBe('contain')
    expect(fit.width / 300).toBeLessThanOrEqual(1.15)
  })

  it('contains tall and wide images whole instead of cropping hard', () => {
    const tall = fitImage(800, 1600, 564, 330)
    expect(tall.mode).toBe('contain')
    expect(tall.height).toBeLessThanOrEqual(330)
    const wide = fitImage(2400, 600, 564, 330)
    expect(wide.mode).toBe('contain')
    expect(wide.width).toBeLessThanOrEqual(564)
  })
})

const img = (kind: ReelImage['kind'], n: number): ReelImage => ({ src: `job/img${n}.jpg`, kind })
const beat = (type: 'image' | 'title' | 'stat'): Scene => ({
  kind: 'beat',
  start: 0,
  end: 1,
  text: 'x',
  visual:
    type === 'title'
      ? { type, title: 't' }
      : type === 'stat'
        ? { type, label: 'l', value: '1' }
        : { type },
})
const scenes = (...b: Scene[]): Scene[] => [
  { kind: 'hook', start: 0, end: 1, text: 'h' },
  ...b,
  { kind: 'outro', start: 0, end: 1, text: 'o' },
]

describe('planImages', () => {
  it('has no plan without images', () => {
    const plan = planImages({ images: [], scenes: scenes(beat('image')) })
    expect(plan.hero).toBeNull()
    expect(plan.beats.size).toBe(0)
  })

  it('uses a thumbnail or og as hero and figures for image beats', () => {
    const plan = planImages({
      images: [img('figure', 1), img('og', 2), img('figure', 3)],
      scenes: scenes(beat('stat'), beat('image'), beat('image'), beat('stat')),
    })
    expect(plan.hero?.kind).toBe('og')
    expect([...plan.beats.keys()]).toEqual([2, 3])
    expect(plan.beats.get(2)?.src).toBe('job/img1.jpg')
  })

  it('keeps at least half the beats as drawn or text scenes', () => {
    const plan = planImages({
      images: [img('og', 1), img('figure', 2), img('figure', 3), img('figure', 4)],
      scenes: scenes(beat('title'), beat('image'), beat('title'), beat('image')),
    })
    expect(plan.beats.size).toBeLessThanOrEqual(2)
  })

  it('a single image only becomes the hero', () => {
    const plan = planImages({
      images: [img('thumbnail', 1)],
      scenes: scenes(beat('image'), beat('stat')),
    })
    expect(plan.hero?.kind).toBe('thumbnail')
    expect(plan.beats.size).toBe(0)
  })
})

describe('captionFor', () => {
  it('uses the figure number when the alt carries one', () => {
    expect(captionFor({ ...img('figure', 1), alt: 'Figure 2: AIME accuracy' }, 'arxiv.org')).toBe(
      'Figure 2',
    )
    expect(captionFor({ ...img('figure', 1), alt: 'Fig. 3 loss' }, 'arxiv.org')).toBe('Figure 3')
  })
  it('falls back to the domain', () => {
    expect(captionFor(img('og', 1), 'example.com')).toBe('example.com')
    expect(captionFor(img('figure', 1), 'example.com')).toBe('Figure · example.com')
  })
})

describe('isBrandImage', () => {
  const title = 'Outlook.com Is Quietly Rejecting Email from Domains Without DMARC'
  it("skips a site's default share card", () => {
    const og = { src: 'x', kind: 'og' as const, alt: 'MailRoute — Cloud Email Security' }
    expect(isBrandImage(og, title, 'mailroute.net')).toBe(true)
  })
  it('keeps story images and images without alt text', () => {
    const story = { src: 'x', kind: 'og' as const, alt: 'Outlook rejecting email without DMARC' }
    expect(isBrandImage(story, title, 'mailroute.net')).toBe(false)
    expect(isBrandImage({ src: 'x', kind: 'og' }, title, 'mailroute.net')).toBe(false)
    const fig = { src: 'x', kind: 'figure' as const, alt: 'MailRoute pipeline' }
    expect(isBrandImage(fig, title, 'mailroute.net')).toBe(false)
  })
})

describe('wideFigureZoom', () => {
  it('shows the whole figure first and never pushes in past a quarter of its width', () => {
    const { base, zoom } = wideFigureZoom(1280, 429, 799, 495)
    expect(base).toBeCloseTo(799 / 1280)
    expect(zoom).toBeLessThanOrEqual(MAX_FIGURE_ZOOM)
    expect(1 / zoom).toBeGreaterThan(0.75)
  })

  it('does not zoom a figure that already fills its card', () => {
    expect(wideFigureZoom(800, 450, 799, 450).zoom).toBeCloseTo(1, 2)
  })
})
