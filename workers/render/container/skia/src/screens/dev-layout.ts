import type { DemoPart } from '@plan/lib/demo'
import type { Token } from '@plan/lib/highlight'
import type { ReelCtx } from '../plan'

/** Owner and repo name from the facts, else the demo's repo, the domain or a "owner/name" title. */
export function repoIdentity(ctx: Pick<ReelCtx, 'facts' | 'demo' | 'domain' | 'title'>): {
  owner: string
  name: string
} {
  const r = ctx.facts.repo
  if (r?.owner && r.name) return { owner: r.owner, name: r.name }
  const d = /^([^/\s]+)\/([^/\s]+)$/.exec(ctx.demo?.repo ?? '')
  if (d?.[1] && d[2]) return { owner: d[1], name: d[2] }
  const m = /github\.com\/([^/\s]+)\/([^/\s]+)/.exec(ctx.domain)
  if (m?.[1] && m[2]) return { owner: m[1], name: m[2] }
  const parts = ctx.title.split('/')
  if (parts.length === 2 && parts[0] && parts[1])
    return { owner: parts[0].trim(), name: parts[1].trim() }
  return { owner: '', name: ctx.title }
}

/** Splits highlighted tokens into rows of at most `cols` characters (a long line wraps, never clips). */
export function tokenRows(tokens: readonly Token[], cols: number): Token[][] {
  const width = Math.max(1, Math.floor(cols))
  const rows: Token[][] = [[]]
  let used = 0
  for (const tok of tokens) {
    let rest = tok.text
    while (rest.length > 0) {
      if (used >= width) {
        rows.push([])
        used = 0
      }
      const take = rest.slice(0, width - used)
      rows[rows.length - 1]!.push({ text: take, kind: tok.kind })
      used += take.length
      rest = rest.slice(take.length)
    }
  }
  return rows
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * The two crops of a README demo inside a w x h window: cut 1 opens on the left edge of the demo's
 * content (so its heading is never cut), cut 2 zooms closer on the densest region.
 */
export function demoCrops(
  demo: {
    width?: number
    height?: number
    focus?: { x: number; y: number }
    content?: { x0: number; x1: number }
    static?: boolean
  },
  w: number,
  h: number,
): [DemoPart, DemoPart] {
  const iw = demo.width ?? 1280
  const ih = demo.height ?? 720
  const focus = demo.focus ?? { x: 0.5, y: 0.5 }
  const content = demo.content ?? { x0: 0, x1: 1 }
  const make = (zoom: number, startX: number, endX: number, fy: number): DemoPart => {
    const scale = Math.max(h / ih, w / iw) * zoom
    const videoWidth = Math.round(iw * scale)
    const videoHeight = Math.round(ih * scale)
    const maxX = Math.max(0, videoWidth - w)
    const maxY = Math.max(0, videoHeight - h)
    const at = (share: number) => -clamp(share * videoWidth, 0, maxX)
    const y = -clamp(fy * videoHeight - h / 2, 0, maxY)
    return { videoWidth, videoHeight, from: { x: at(startX), y }, to: { x: at(endX), y } }
  }
  const visible = w / Math.round(iw * Math.max(h / ih, w / iw))
  const fits = content.x1 - content.x0 <= visible
  const open = fits ? (content.x0 + content.x1) / 2 - visible / 2 : content.x0
  const close = clamp(focus.x - visible / 1.3 / 2, 0, 1)
  const zoom = demo.static ? 1.25 : 1.3
  return [
    make(demo.static ? zoom : 1, open, open, demo.static ? focus.y : 0.5),
    make(
      zoom * (demo.static ? 1.2 : 1),
      demo.static ? close : open,
      demo.static ? close : open,
      focus.y,
    ),
  ]
}

/** Size to decode a demo at: its own pixels, capped so a micro box is not drowned in raw frames. */
export function demoDecodeSize(
  demo: { width?: number; height?: number },
  cap = 1280,
): { w: number; h: number } {
  const iw = demo.width ?? 1280
  const ih = demo.height ?? 720
  const k = Math.min(1, cap / Math.max(iw, ih))
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(iw * k), h: even(ih * k) }
}
