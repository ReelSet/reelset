import type { Canvas } from '@napi-rs/canvas'
import { keyPhraseIn } from '@plan/lib/extract'
import { captionFor, wideFigureZoom } from '@plan/lib/images'
import { parseStat } from '@plan/lib/count'
import { clipWords, columnWidths, fitLabel, plainText, readTable, rowHeight } from '@plan/lib/table'
import { typeset } from '@plan/lib/typeset'
import { card, clip, fit, fitBlock, riseLines, rrect, sprite, text, wrap } from '../engine/draw'
import { COL, H, W, ZONE_BOTTOM, eo, pr, prop } from '../engine/kit'
import { fallback } from './core'
import { latexToText } from './latex'
import { page, zone } from './page'
import {
  HAIR,
  TONE_DIM,
  drawPhoto,
  fitPassage,
  imageOf,
  paragraph,
  pill,
  pillHeight,
} from './parts'
import type { DrawArgs, Screen } from './types'

const arxivId = (domain: string) => /arxiv\.org\/(?:abs|pdf)\/([^\s?]+)/.exec(domain)?.[1] ?? ''
const rise = (p: number, d = 36) => [Math.min(1, eo(p) * 1.4), (1 - eo(p)) * d] as const

function arxivPill(a: DrawArgs, x: number, y: number): number {
  const id = arxivId(a.ctx.domain)
  const { c, t } = a
  const [al, dy] = rise(pr(t, 0, 0.45), 20)
  c.save()
  c.globalAlpha = al
  const w = pill(c, `arXiv${id ? `:${id}` : ''}`, x, y + dy, 28, { fill: COL.arxiv, fg: '#fff' })
  c.restore()
  return w
}

/* -------------------------------- PaperPage -------------------------------- */

export const PaperPage: Screen = {
  draw(a) {
    page(a)
    const variant = prop<string>(a.shot.props, 'variant', 'title')
    if (variant === 'abstract') return drawAbstract(a)
    if (variant === 'figure' && imageOf(a)) return drawPaperFigure(a)
    drawPaperTitle(a)
  },
}

function drawPaperTitle(a: DrawArgs): void {
  const { c, t, ctx } = a
  const z = zone(a)
  const paper = ctx.facts.paper
  const title = a.memo('title', () =>
    fitBlock(typeset(ctx.title), 'display', z.w, 560, {
      max: 96,
      min: 52,
      lh: 1.04,
      ls: -0.035,
      maxLines: 7,
    }),
  )
  const authors = paper?.authors?.length
    ? `${paper.authors.slice(0, 4).join(', ')}${paper.authors.length > 4 ? ' et al.' : ''}`
    : ''
  const authLay = a.memo('auth', () =>
    authors ? fitBlock(authors, 'ui', z.w, 150, { max: 36, min: 26, lh: 1.3, maxLines: 3 }) : null,
  )
  const h =
    90 +
    title.lines.length * title.size * 1.04 +
    (authLay ? 40 + authLay.lines.length * authLay.size * 1.3 : 0)
  const top = z.y + Math.max(0, (z.h - h) / 2 - 30)
  arxivPill(a, z.x, top)
  riseLines(c, title.lines, z.x, top + 90, 'display', title.size, COL.white, t, 0.08, {
    lh: 1.04,
    ls: -0.035,
    step: 0.06,
  })
  if (authLay) {
    const ay = top + 90 + title.lines.length * title.size * 1.04 + 40
    c.save()
    c.globalAlpha = eo(pr(t, 0.45, 0.5))
    rrect(c, z.x, ay - 22, 70, 5, 3)
    c.fillStyle = COL.lime
    c.fill()
    c.restore()
    riseLines(c, authLay.lines, z.x, ay, 'ui', authLay.size, TONE_DIM, t, 0.5, {
      lh: 1.3,
      step: 0.03,
    })
  }
}

function drawAbstract(a: DrawArgs): void {
  const { c, t, ctx } = a
  const z = zone(a)
  const paper = ctx.facts.paper
  const abstract = plainText(paper?.abstract ?? prop<string>(a.shot.props, 'summary', ctx.hook))
  const phrase = prop<string>(a.shot.props, 'phrase', '') || keyPhraseIn(abstract, 2, 4) || ''
  const small = a.memo('small', () =>
    fitBlock(typeset(ctx.title), 'bold', z.w, 140, { max: 36, min: 28, lh: 1.2, maxLines: 3 }),
  )
  const headH = 70 + 24 + small.lines.length * small.size * 1.2 + 30 + 3 + 26 + 40
  const body = a.memo('body', () =>
    fitPassage(abstract, phrase, z.w, z.h - headH - 10, { max: 60, min: 38, lh: 1.3 }),
  )
  arxivPill(a, z.x, z.y)
  riseLines(c, small.lines, z.x, z.y + 94, 'bold', small.size, TONE_DIM, t, 0.1, {
    lh: 1.2,
    step: 0.03,
  })
  const ry = z.y + 70 + 24 + small.lines.length * small.size * 1.2 + 30
  c.fillStyle = HAIR
  c.fillRect(z.x, ry, z.w * eo(pr(t, 0.15, 0.5)), 3)
  const label = paper?.abstract ? 'ABSTRACT' : 'SUMMARY'
  riseLines(c, [label], z.x, ry + 24, 'monoB', 28, TONE_DIM, t, 0.25, { ls: 0.12, step: 0.03 })
  paragraph(c, body.body, z.x, ry + 24 + 60, z.w, 0, t, 0.35, {
    layout: body.lay,
    lh: 1.3,
    phrase,
    color: 'rgba(246,244,238,0.92)',
  })
}

function drawPaperFigure(a: DrawArgs): void {
  const { c, t, ctx } = a
  const z = zone(a)
  const hit = imageOf(a)
  if (!hit) return
  const small = a.memo('small', () =>
    fitBlock(typeset(ctx.title), 'bold', z.w, 110, { max: 34, min: 26, lh: 1.2, maxLines: 2 }),
  )
  arxivPill(a, z.x, z.y)
  riseLines(c, small.lines, z.x, z.y + 94, 'bold', small.size, TONE_DIM, t, 0.1, {
    lh: 1.2,
    step: 0.03,
  })
  const top = z.y + 94 + small.lines.length * small.size * 1.2 + 30
  const box = { x: z.x, y: top, w: z.w, h: ZONE_BOTTOM - top - 6 }
  const [al, dy] = rise(pr(t, 0.05, 0.55), 44)
  c.save()
  c.globalAlpha = al
  c.translate(0, dy)
  card(c, box.x, box.y, box.w, box.h, { r: 26, fill: '#fafafa', stroke: null })
  drawPhoto(a, hit.img, box, {
    key: `fig${hit.i}`,
    backdrop: false,
    contain: true,
    zoom: 1.06,
    r: 26,
    maxUp: 1.4,
  })
  c.restore()
  const cap = captionFor(hit.meta, ctx.domain)
  const p = eo(pr(t, 0.3, 0.45))
  c.save()
  c.globalAlpha = p
  pill(c, cap, box.x + 22, box.y + 22 + (1 - p) * 14, 26, { fill: COL.arxiv, fg: '#fff' })
  c.restore()
}

/* -------------------------------- FigureZoom -------------------------------- */

const ORIGINS: [number, number][] = [
  [0.28, 0.3],
  [0.72, 0.34],
  [0.3, 0.72],
  [0.7, 0.7],
]

const clampFocus = (n: number) => Math.min(0.9, Math.max(0.1, n))

function focusOf(meta: { focus?: { x: number; y: number } }, fallbackAt: [number, number]) {
  const f = meta.focus
  if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y))
    return { x: fallbackAt[0], y: fallbackAt[1] }
  return { x: clampFocus(f.x), y: clampFocus(f.y) }
}

const altOf = (alt: string | undefined) =>
  plainText(alt ?? '').replace(/^\s*fig(?:ure|\.)?\s*\d+[a-z]?\s*[:.\-]?\s*/i, '')

let scrimBottom: Canvas | null = null

export const FigureZoom: Screen = {
  draw(a) {
    const hit = imageOf(a)
    if (!hit) return fallback.draw(a)
    const variant = prop<number>(a.shot.props, 'variant', 0)
    const wide = hit.img.width / hit.img.height >= 1.5
    if (wide) return drawWideFigure(a, hit, variant)
    drawTallFigure(a, hit, variant)
  },
}

type Hit = NonNullable<ReturnType<typeof imageOf>>

function altBlock(a: DrawArgs, alt: string, maxW: number, maxH: number) {
  return a.memo('alt', () =>
    alt
      ? fitBlock(clipWords(alt, 140), 'ui', maxW, maxH, { max: 38, min: 28, lh: 1.3, maxLines: 4 })
      : null,
  )
}

function drawWideFigure(a: DrawArgs, hit: Hit, variant: number): void {
  const { c, t, shot, ctx } = a
  page(a)
  const z = zone(a)
  const alt = altOf(hit.meta.alt)
  const altLay = altBlock(a, alt, z.w, 190)
  const altH = altLay ? altLay.lines.length * altLay.size * 1.3 + 34 : 0
  const cardTop = z.y + 92
  const room = ZONE_BOTTOM - cardTop - altH - 6
  const iw = hit.img.width
  const ih = hit.img.height
  const cardH = Math.min(room, Math.max(ih * Math.min(1.2, z.w / iw), Math.round(z.w * 0.62)))
  const { base, zoom } = wideFigureZoom(iw, ih, z.w, cardH)
  const p = eo(pr(t, 0.13, shot.dur * 0.8))
  const zz = 1 + (zoom - 1) * p
  const f = focusOf(hit.meta, variant % 2 === 0 ? [0.3, 0.5] : [0.7, 0.5])
  const dw = iw * base * zz
  const dh = ih * base * zz
  const left = Math.min(0, Math.max(z.w - dw, z.w / 2 - dw * f.x))
  const topIn =
    dh <= cardH ? (cardH - dh) / 2 : Math.min(0, Math.max(cardH - dh, cardH / 2 - dh * f.y))
  const [al, dy] = rise(pr(t, 0.05, 0.55), 44)
  c.save()
  c.globalAlpha = al
  c.translate(0, dy)
  card(c, z.x, cardTop, z.w, cardH, { r: 24, fill: '#fafafa', stroke: null })
  c.save()
  rrect(c, z.x, cardTop, z.w, cardH, 24)
  c.clip()
  c.drawImage(hit.img as Canvas, z.x + left, cardTop + topIn, dw, dh)
  c.restore()
  c.restore()
  const cp = eo(pr(t, 0, 0.45))
  c.save()
  c.globalAlpha = cp
  pill(c, captionFor(hit.meta, ctx.domain).toUpperCase(), z.x, z.y + 8 + (1 - cp) * 18, 28, {
    fill: COL.lime,
    fg: COL.limeInk,
  })
  c.restore()
  if (altLay)
    riseLines(
      c,
      altLay.lines,
      z.x,
      cardTop + cardH + 26,
      'ui',
      altLay.size,
      'rgba(246,244,238,0.85)',
      t,
      0.4,
      { lh: 1.3, step: 0.025 },
    )
}

function drawTallFigure(a: DrawArgs, hit: Hit, variant: number): void {
  const { c, t, ctx } = a
  c.fillStyle = COL.ink
  c.fillRect(0, 0, W, H)
  const z = zone(a)
  const focus = focusOf(hit.meta, ORIGINS[variant % 4]!)
  drawPhoto(
    a,
    hit.img,
    { x: 0, y: 0, w: W, h: H },
    { key: `tall${hit.i}`, focus, zoom: 1.2, maxUp: 1.2 },
  )
  scrimBottom ??= buildScrim()
  c.drawImage(scrimBottom, 0, 0)
  const s = 0.8 + 0.2 * eo(pr(t, 0, 0.5))
  c.save()
  c.translate(z.x, z.y + 8)
  c.scale(s, s)
  c.globalAlpha = eo(pr(t, 0, 0.4))
  pill(c, captionFor(hit.meta, ctx.domain).toUpperCase(), 0, 0, 28, {
    fill: COL.lime,
    fg: COL.limeInk,
  })
  c.restore()
  const alt = altOf(hit.meta.alt)
  const altLay = altBlock(a, alt, z.w, 220)
  if (!altLay) return
  const h = altLay.lines.length * altLay.size * 1.3
  riseLines(c, altLay.lines, z.x, ZONE_BOTTOM - h - 6, 'ui', altLay.size, COL.white, t, 0.35, {
    lh: 1.3,
    step: 0.025,
  })
}

function buildScrim(): Canvas {
  return sprite(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H)
    gr.addColorStop(0, 'rgba(11,11,14,0.45)')
    gr.addColorStop(0.22, 'rgba(11,11,14,0)')
    gr.addColorStop(0.5, 'rgba(11,11,14,0.1)')
    gr.addColorStop(0.66, 'rgba(11,11,14,0.82)')
    gr.addColorStop(1, 'rgba(11,11,14,0.9)')
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)
  })
}

/* -------------------------------- TableScreen -------------------------------- */

const VALUE_BLOCK = 210

export const TableScreen: Screen = {
  draw(a) {
    const { c, t } = a
    const table = readTable(a.shot.props)
    if (!table) return fallback.draw(a)
    page(a)
    const z = zone(a)
    const lay = a.memo('lay', () => {
      const reserve = table.value ? VALUE_BLOCK : 0
      const rh = rowHeight(z.h - reserve, table.rows.length, 96, 150)
      const widths = columnWidths(table.headers.length, z.w)
      const valueSize = fit(table.value || '0', 'display', z.w, 130, 70, -0.04)
      const total = 62 + 26 + 96 + table.rows.length * rh + (table.value ? 36 + 34 + valueSize : 0)
      return { rh, widths, valueSize, total }
    })
    const top = z.y + Math.max(0, (z.h - lay.total) / 2 - 10)
    drawTableHead(a, table, z.x, top, z.w)
    drawTableBody(a, table, lay, z.x, top + 62 + 26, z.w)
    if (table.value)
      drawTableValue(
        a,
        table,
        lay.valueSize,
        z.x,
        top + 62 + 26 + 96 + table.rows.length * lay.rh + 36,
        z.w,
      )
  },
}

type TableView = NonNullable<ReturnType<typeof readTable>>
type TableLay = { rh: number; widths: number[]; valueSize: number }

function drawTableHead(a: DrawArgs, table: TableView, x: number, y: number, w: number): void {
  const { c, t } = a
  const p = eo(pr(t, 0, 0.45))
  c.save()
  c.globalAlpha = p
  const label = table.ref.toUpperCase()
  const pw = pill(c, label, x, y + (1 - p) * 16, 26, { fill: COL.lime, fg: COL.limeInk })
  const cap = clip(clipWords(plainText(table.caption), 80), 'ui', 26, w - pw - 24)
  text(c, cap, x + pw + 20, y + pillHeight(26) / 2 + 9, 'ui', 26, TONE_DIM, { weight: 600 })
  c.restore()
}

function drawTableBody(
  a: DrawArgs,
  table: TableView,
  lay: TableLay,
  x: number,
  y: number,
  w: number,
): void {
  const { c, t } = a
  const [al, dy] = rise(pr(t, 0.05, 0.5), 30)
  const h = 96 + table.rows.length * lay.rh
  c.save()
  c.globalAlpha = al
  c.translate(0, dy)
  card(c, x, y, w, h, { r: 30, fill: COL.ink2 })
  c.save()
  rrect(c, x, y, w, h, 30)
  c.clip()
  let cx = x
  table.headers.forEach((hd, ci) => {
    const isKey = ci === table.mark?.col
    const cw = lay.widths[ci]!
    const lines = wrap(hd.toUpperCase(), 'monoB', 20, cw - 24, 0.02, 'hyphen').slice(0, 2)
    const tx = ci === 0 ? cx + 28 : cx + cw / 2
    lines.forEach((ln, li) => {
      const base = y + 86 - (lines.length - 1 - li) * 26
      text(
        c,
        clip(ln, 'monoB', 20, cw - 20, 0.02),
        tx,
        base,
        'monoB',
        20,
        isKey ? COL.lime : TONE_DIM,
        { ls: 0.02, align: ci === 0 ? 'left' : 'center' },
      )
    })
    cx += lay.widths[ci]!
  })
  c.fillStyle = HAIR
  c.fillRect(x, y + 94, w, 1.5)
  const stat = parseStat(table.value)
  table.rows.forEach((row, r) =>
    drawRow(a, table, lay, row, r, x, y + 96 + r * lay.rh, w, stat !== null),
  )
  c.restore()
  c.restore()
}

function drawRow(
  a: DrawArgs,
  table: TableView,
  lay: TableLay,
  row: string[],
  r: number,
  x: number,
  y: number,
  w: number,
  _stat: boolean,
): void {
  const { c, t } = a
  const p = eo(pr(t, 0.12 + r * 0.06, 0.45))
  c.save()
  c.globalAlpha = p
  c.translate((1 - p) * 30, 0)
  if (r > 0) {
    c.fillStyle = HAIR
    c.fillRect(x, y, w, 1)
  }
  const isHi = r === table.mark?.row
  if (isHi) {
    const sweep = w * eo(pr(t, 0.4, 0.55))
    c.fillStyle = 'rgba(200,247,81,0.16)'
    c.fillRect(x, y, sweep, lay.rh)
    c.fillStyle = COL.lime
    c.fillRect(x, y, 8, lay.rh)
  }
  let cx = x
  row.forEach((cell, ci) => {
    const best = table.best.has(`${r}:${ci}`)
    const key = isHi && ci === table.mark?.col
    const cw = lay.widths[ci]!
    const size =
      ci === 0
        ? fitLabel(cell, cw - 40, Math.min(44, lay.rh * 0.45), 22)
        : Math.min(54, Math.round(lay.rh * 0.5))
    const font = best || isHi || ci > 0 ? 'display' : 'bold'
    const color =
      best || key ? COL.lime : ci === 0 ? 'rgba(246,244,238,0.9)' : 'rgba(246,244,238,0.82)'
    const str = clip(cell, font, size, cw - 28, -0.02)
    text(
      c,
      str,
      ci === 0 ? cx + 28 : cx + cw / 2,
      y + lay.rh / 2 + size * 0.34,
      font,
      size,
      color,
      {
        ls: -0.02,
        align: ci === 0 ? 'left' : 'center',
      },
    )
    cx += cw
  })
  c.restore()
}

function drawTableValue(
  a: DrawArgs,
  table: TableView,
  size: number,
  x: number,
  y: number,
  w: number,
): void {
  const { c, t } = a
  riseLines(
    c,
    [clip(table.label.toUpperCase(), 'monoB', 28, w, 0.06)],
    x,
    y,
    'monoB',
    28,
    TONE_DIM,
    t,
    0.5,
    { ls: 0.06 },
  )
  riseLines(c, [table.value], x, y + 40, 'display', size, COL.lime, t, 0.58, { ls: -0.04 })
}

/* ------------------------------- EquationScreen ------------------------------- */

export const EquationScreen: Screen = {
  draw(a) {
    const { c, t } = a
    const latex = prop<string>(a.shot.props, 'latex', '')
    const label = prop<string>(a.shot.props, 'label', '')
    const rows = a.memo('rows', () => latexToText(latex))
    if (rows.length === 0) return fallback.draw(a)
    page(a)
    const z = zone(a)
    const innerW = z.w - 96
    const lay = a.memo('lay', () => layoutEquation(rows, innerW))
    const cardH = Math.max(300, lay.h + 150)
    const total = 62 + 36 + cardH
    const top = z.y + Math.max(0, (z.h - total) / 2 - 10)
    const p0 = eo(pr(t, 0, 0.45))
    c.save()
    c.globalAlpha = p0
    const pw = pill(c, 'KEY EQUATION', z.x, top + (1 - p0) * 16, 28, {
      fill: COL.lime,
      fg: COL.limeInk,
    })
    if (label)
      text(c, clip(label, 'bold', 32, z.w - pw - 28), z.x + pw + 22, top + 38, 'bold', 32, TONE_DIM)
    c.restore()
    const [al, dy] = rise(pr(t, 0.06, 0.55), 40)
    const cy = top + 62 + 36
    c.save()
    c.globalAlpha = al
    c.translate(0, dy)
    card(c, z.x, cy, z.w, cardH, { r: 34, fill: COL.ink2 })
    c.restore()
    const start = cy + (cardH - lay.h - 40) / 2 + 10
    lay.lines.forEach((line, i) => {
      riseLines(
        c,
        [line],
        z.x + z.w / 2,
        start + i * lay.size * 1.25,
        'serif',
        lay.size,
        COL.white,
        t,
        0.18 + i * 0.12,
        {
          align: 'center',
          step: 0.04,
          lh: 1.25,
        },
      )
    })
    rrect(c, z.x + 48, cy + cardH - 52, (z.w - 96) * eo(pr(t, 0.3, 0.6)), 8, 4)
    c.fillStyle = COL.lime
    c.fill()
  },
}

/** Largest serif size at which every row of the equation (wrapped at hyphens/chars if needed) fits `w`. */
function layoutEquation(rows: string[], w: number): { size: number; lines: string[]; h: number } {
  const maxChars = Math.max(...rows.map((r) => r.length))
  const start = maxChars > 110 ? 62 : maxChars > 70 ? 76 : 96
  for (let size = start; size >= 36; size -= 2) {
    const lines = rows.flatMap((r) => wrapEquation(r, size, w))
    if (lines.length * size * 1.25 <= 560 && lines.length <= rows.length + 2)
      return { size, lines, h: lines.length * size * 1.25 }
  }
  const lines = rows.flatMap((r) => wrapEquation(r, 36, w)).slice(0, 8)
  return { size: 36, lines, h: lines.length * 36 * 1.25 }
}

const wrapEquation = (row: string, size: number, w: number) =>
  wrap(row, 'serif', size, w, 0, 'hyphen')
