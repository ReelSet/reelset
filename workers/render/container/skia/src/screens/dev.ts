import { tokenize, type Token, type TokenKind } from '@plan/lib/highlight'
import { codeKind, cardLines, isShortCode } from '@plan/lib/looks'
import { buildSession, revealSession, type SessionRow } from '@plan/lib/terminal'
import { typeset } from '@plan/lib/typeset'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import {
  card,
  fitBlock,
  icon,
  measure,
  riseLines,
  rrect,
  text,
  wrap,
  type Ctx,
} from '../engine/draw'
import { COL, FPS, ZONE_BOTTOM, eio, eo, mix, pr, prop } from '../engine/kit'
import { demoCrops, demoDecodeSize, repoIdentity, tokenRows } from './dev-layout'
import { fallback } from './core'
import { HAIR, TONE_DIM, flowPills, paintSoft, pill } from './parts'
import { fitInto, page, zone } from './page'
import type { DrawArgs, Screen } from './types'

const LANG_COLOR: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Rust: '#dea584',
  Go: '#00add8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#8a8a8a',
  'C#': '#178600',
  Ruby: '#cc342d',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#7e57c2',
  Zig: '#ec915c',
  Lua: '#6a7ecf',
  Dockerfile: '#4a90c2',
  Jupyter: '#da5b0b',
  Vue: '#41b883',
}
const langColor = (name: string) => LANG_COLOR[name] ?? COL.lime

const SYNTAX: Record<TokenKind, string> = {
  keyword: COL.coral,
  string: '#c8f751',
  number: '#8fd3ff',
  comment: '#6f6f78',
  call: '#f6f4ee',
  type: '#ffc46b',
  plain: '#d9d6cc',
}

const EXT: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  rust: 'rs',
  bash: 'sh',
  yaml: 'yml',
}

const slide = (p: number, d = 36) => [eo(p), (1 - eo(p)) * d] as const

/** Draws one row of tokens at (x, base); returns the x it ended at. */
function drawTokens(
  c: Ctx,
  tokens: readonly Token[],
  x: number,
  base: number,
  size: number,
): number {
  let cx = x
  for (const tok of tokens) {
    text(c, tok.text, cx, base, 'mono', size, SYNTAX[tok.kind])
    cx += measure(tok.text, 'mono', size)
  }
  return cx
}

const monoW = (size: number) => measure('M', 'mono', size)

/* ------------------------------- RepoPage ------------------------------- */

type RepoLay = {
  h: number
  sparse: boolean
  owner: string
  name: { size: number; lines: string[] }
  desc: { size: number; lines: string[] } | null
  langs: { name: string; pct: number }[]
  legend: { name: string; pct: number; x: number; y: number; w: number }[]
  legendH: number
  topics: ReturnType<typeof flowPills>
  demo: { h: number; vh: number } | null
}

const README_W = 790

/** The frozen README clip shown on the repo card when the reel does not play the demo as a shot. */
function readmeClip(a: { ctx: DrawArgs['ctx'] }) {
  const d = a.ctx.demo
  if (!d || a.ctx.demoInPlan) return null
  const vh = Math.min(420, Math.round((README_W * (d.height ?? 720)) / (d.width ?? 1280)))
  return { vh, vw: README_W, demo: d }
}

function layoutRepo(a: DrawArgs): RepoLay {
  const w = zone(a).w
  const { owner, name } = repoIdentity(a.ctx)
  const r = a.ctx.facts.repo
  const desc = typeset(r?.description ?? '')
  const langs = (
    r?.languages?.length
      ? r.languages.slice(0, 5)
      : r?.language
        ? [{ name: r.language, pct: 100 }]
        : []
  ).filter((l) => l.name)
  const topics = (r?.topics ?? []).slice(0, 6)
  const sparse = !desc && !topics.length && !langs.length
  const nameLay = fitBlock(name, 'display', w, sparse ? 380 : 250, {
    max: sparse ? 170 : 112,
    min: 52,
    lh: 1.0,
    ls: -0.035,
    maxLines: sparse ? 3 : 2,
  })
  const hasMeta = topics.length > 0 || langs.length > 0
  const descLay = desc
    ? fitBlock(desc, 'bold', w, 300, { max: hasMeta ? 46 : 56, min: 32, lh: 1.22, maxLines: 6 })
    : null
  let y = 70 + 10 + nameLay.lines.length * nameLay.size
  if (descLay) y += 34 + descLay.lines.length * descLay.size * 1.22
  const legend: RepoLay['legend'] = []
  let legendH = 0
  if (langs.length) {
    let lx = 0
    let ly = 0
    for (const l of langs) {
      const label = langs.length > 1 ? `${l.pct.toFixed(1)}%` : ''
      const lw = 30 + measure(l.name, 'bold', 32) + (label ? 14 + measure(label, 'mono', 28) : 0)
      if (lx > 0 && lx + lw > w) {
        lx = 0
        ly += 50
      }
      legend.push({ name: l.name, pct: l.pct, x: lx, y: ly, w: lw })
      lx += lw + 32
    }
    legendH = ly + 40
    y += 44 + 16 + 22 + legendH
  }
  const pills = flowPills(topics, 26, w)
  if (pills.h) y += 36 + pills.h
  const clip = readmeClip(a)
  const demo = clip ? { h: 64 + clip.vh + 8, vh: clip.vh } : null
  if (demo) y += 40 + demo.h
  return {
    h: y,
    sparse,
    owner,
    name: nameLay,
    desc: descLay,
    langs,
    legend,
    legendH,
    topics: pills,
    demo,
  }
}

export const RepoPage: Screen = {
  video(shot, reel) {
    const clip = readmeClip({ ctx: reel.ctx })
    if (!clip) return null
    return {
      src: clip.demo.src,
      at: Math.min(2, clip.demo.seconds / 2),
      frames: 1,
      w: clip.vw - 6,
      h: clip.vh,
      mode: 'fit',
    }
  },
  draw(a) {
    const { c, t } = a
    page(a)
    const lay = a.memo('lay', () => layoutRepo(a))
    const z = zone(a)
    fitInto(c, z, z.w, lay.h, () => drawRepo(a, lay, z.w), lay.sparse || lay.h < z.h * 0.6)
  },
}

function drawRepo(a: DrawArgs, lay: RepoLay, w: number): void {
  const { c, t } = a
  let y = 0
  const pOwner = eo(pr(t, 0, 0.5))
  c.save()
  c.globalAlpha = pOwner
  icon(c, 'book-open', 0, y + 8, 44, pOwner, TONE_DIM, 1.8)
  if (lay.owner) text(c, `${lay.owner} /`, 64, y + 42, 'mono', 38, TONE_DIM)
  c.restore()
  y += 70
  const nameTop = y + 10
  riseLines(c, lay.name.lines, 0, nameTop, 'display', lay.name.size, COL.white, t, 0.06, {
    lh: 1.0,
    ls: -0.035,
    step: 0.08,
  })
  y = nameTop + lay.name.lines.length * lay.name.size
  if (!lay.langs.length) {
    rrect(c, 0, y + 14, 84 * eo(pr(t, 0.3, 0.5)), 8, 4)
    c.fillStyle = COL.lime
    c.fill()
  }
  if (lay.desc) {
    y += 34
    riseLines(c, lay.desc.lines, 0, y, 'bold', lay.desc.size, 'rgba(246,244,238,0.82)', t, 0.2, {
      lh: 1.22,
      step: 0.03,
    })
    y += lay.desc.lines.length * lay.desc.size * 1.22
  }
  if (lay.langs.length) {
    y += 44
    drawLangBar(c, lay, y, w, t)
    y += 16 + 22 + lay.legendH
  }
  if (lay.topics.h) {
    y += 36
    lay.topics.items.forEach((it, i) => {
      const p = eo(pr(t, 0.5 + i * 0.05, 0.45))
      c.save()
      c.globalAlpha = p
      pill(c, it.label, it.x, y + it.y + (1 - p) * 20, 26, {
        fill: 'rgba(200,247,81,0.08)',
        fg: COL.lime,
        stroke: 'rgba(200,247,81,0.28)',
      })
      c.restore()
    })
    y += lay.topics.h
  }
  if (lay.demo) {
    y += 40
    drawReadme(a, y, w, lay.demo)
  }
}

function drawLangBar(c: Ctx, lay: RepoLay, y: number, w: number, t: number): void {
  const grow = eo(pr(t, 0.35, 0.7))
  const total = lay.langs.reduce((s, l) => s + l.pct, 0) || 1
  c.save()
  rrect(c, 0, y, w, 16, 8)
  c.clip()
  c.fillStyle = COL.ink3
  c.fillRect(0, y, w, 16)
  let x = 0
  for (const l of lay.langs) {
    const sw = (l.pct / total) * w * grow
    c.fillStyle = langColor(l.name)
    c.fillRect(x, y, Math.max(0, sw - 3), 16)
    x += sw
  }
  c.restore()
  const base = y + 16 + 22
  for (const it of lay.legend) {
    const p = eo(pr(t, 0.6, 0.5))
    c.save()
    c.globalAlpha = p
    c.beginPath()
    c.arc(it.x + 10, base + it.y + 17, 10, 0, Math.PI * 2)
    c.fillStyle = langColor(it.name)
    c.fill()
    text(c, it.name, it.x + 30, base + it.y + 28, 'bold', 32, COL.white)
    if (lay.langs.length > 1)
      text(
        c,
        `${it.pct.toFixed(1)}%`,
        it.x + 44 + measure(it.name, 'bold', 32),
        base + it.y + 28,
        'mono',
        28,
        TONE_DIM,
      )
    c.restore()
  }
}

function drawReadme(a: DrawArgs, y: number, w: number, demo: { h: number; vh: number }): void {
  const { c, t } = a
  const [al, dy] = slide(pr(t, 0.35, 0.6), 40)
  c.save()
  c.globalAlpha = al
  c.translate(0, dy)
  card(c, 0, y, w, demo.h, { r: 26, fill: COL.ink2 })
  text(c, 'README.md', 28, y + 42, 'monoB', 28, TONE_DIM, { ls: 0.02 })
  c.fillStyle = HAIR
  c.fillRect(0, y + 64, w, 1.5)
  const vid = a.media.video()
  const vx = (w - README_W + 6) / 2
  if (vid) {
    c.save()
    rrect(c, 3, y + 66, w - 6, demo.vh + 4, 0)
    c.clip()
    c.fillStyle = '#000'
    c.fillRect(3, y + 66, w - 6, demo.vh + 4)
    const k = Math.min((w - 6) / vid.width, demo.vh / vid.height)
    c.drawImage(vid, vx + (README_W - 6 - vid.width * k) / 2, y + 68, vid.width * k, vid.height * k)
    c.restore()
  }
  c.restore()
}

/* -------------------------------- Terminal -------------------------------- */

type TermLay = {
  size: number
  cmds: string[][]
  outs: string[][]
  rows: SessionRow[]
  chars: number
  descLay: { size: number; lines: string[] } | null
  facts: string[]
  termH: number
  footH: number
}

const TERM_PAD = 34
const TERM_HEAD = 76

function layoutTerminal(a: DrawArgs): TermLay {
  const z = zone(a)
  const { owner, name } = repoIdentity(a.ctx)
  const r = a.ctx.facts.repo
  const rows = buildSession(prop<string[]>(a.shot.props, 'lines', []), {
    owner,
    name,
    latestRelease: r?.latestRelease,
  })
  const facts = [r?.language, r?.latestRelease].filter((x): x is string => Boolean(x))
  const desc = typeset(r?.description ?? '')
  const descLay = desc
    ? fitBlock(desc, 'bold', z.w, 130, { max: 38, min: 28, lh: 1.25, maxLines: 3 })
    : null
  const reserve =
    (facts.length ? 70 : 0) + (descLay ? descLay.lines.length * descLay.size * 1.25 + 8 : 0)
  const maxTermH = z.h - (reserve ? reserve + 28 : 0)
  const innerW = z.w - TERM_PAD * 2
  const avail = maxTermH - TERM_HEAD - TERM_PAD - 20
  let size = 62
  let cmds: string[][] = []
  let outs: string[][] = []
  for (; size >= 30; size -= 2) {
    const cols = Math.floor(innerW / monoW(size))
    cmds = rows.map((row) => wrapMono(row.cmd, cols - 2))
    outs = rows.map((row) => row.out.flatMap((o) => wrapMono(o, cols)))
    const lines = 1 + cmds.reduce((n, cmd, i) => n + cmd.length + (outs[i]?.length ?? 0), 0)
    if (lines * size * 1.5 + rows.length * size * 0.3 <= avail) break
  }
  const chars = rows.reduce((n, row) => n + row.cmd.length + 4 + row.out.length * 3, 0)
  const lines = 1 + cmds.reduce((n, cmd, i) => n + cmd.length + (outs[i]?.length ?? 0), 0)
  const content = TERM_HEAD + TERM_PAD * 2 + lines * size * 1.5 + rows.length * size * 0.3
  const termH = Math.min(maxTermH, Math.max(420, content))
  return { size, cmds, outs, rows, chars, descLay, facts, termH, footH: reserve ? reserve + 28 : 0 }
}

const wrapMono = (s: string, cols: number): string[] => {
  const out: string[] = []
  for (const word of s.split(/(?<= )/)) {
    const last = out.length ? out[out.length - 1]! : ''
    if (out.length && (last + word).length <= cols) out[out.length - 1] = last + word
    else if (word.length <= cols) out.push(word)
    else for (let i = 0; i < word.length; i += cols) out.push(word.slice(i, i + cols))
  }
  return out.length ? out.map((l) => l.replace(/ $/, '')) : ['']
}

export const Terminal: Screen = {
  draw(a) {
    const { c, t, shot } = a
    page(a)
    const z0 = zone(a)
    const lay = a.memo('lay', () => layoutTerminal(a))
    if (lay.rows.length === 0) return fallback.draw(a)
    const z = { ...z0, y: z0.y + Math.max(0, (z0.h - lay.termH - lay.footH) / 2 - 20) }
    const p = eo(pr(t, 0, 0.5))
    c.save()
    c.globalAlpha = Math.min(1, p * 1.4)
    c.translate(0, (1 - p) * 40)
    card(c, z.x, z.y, z.w, lay.termH, { r: 28, fill: '#0e0e12' })
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      c.beginPath()
      c.arc(z.x + 40 + i * 36, z.y + 38, 11, 0, Math.PI * 2)
      c.fillStyle = col
      c.fill()
    })
    text(c, 'zsh ~/projects', z.x + 170, z.y + 48, 'mono', 28, 'rgba(246,244,238,0.45)')
    c.fillStyle = HAIR
    c.fillRect(z.x, z.y + TERM_HEAD - 8, z.w, 1.5)
    c.restore()
    drawSession(a, lay, z)
    drawTermFooter(a, lay, z)
  },
}

function drawSession(a: DrawArgs, lay: TermLay, z: ReturnType<typeof zone>): void {
  const { c, t, shot } = a
  const frame = t * 30
  const budget = frame * (lay.chars / Math.max(12, shot.dur * 30 * 0.62))
  const reveal = revealSession(lay.rows, budget)
  const { size } = lay
  const lh = size * 1.5
  const chW = monoW(size)
  const x0 = z.x + TERM_PAD
  let y = z.y + TERM_HEAD + TERM_PAD + size * 0.9
  const blink = Math.floor(frame / 8) % 2 === 0
  c.save()
  rrect(c, z.x, z.y, z.w, lay.termH, 28)
  c.clip()
  lay.rows.forEach((row, i) => {
    const v = reveal[i]!
    if (i > 0 && v.typed === 0) return
    let left = v.typed
    const typing = v.typed < row.cmd.length
    lay.cmds[i]!.forEach((line, li) => {
      if (li === 0) text(c, '$', x0, y, 'monoB', size, COL.lime)
      const shown = line.slice(0, left)
      text(c, shown, x0 + chW * 2, y, 'mono', size, COL.white)
      if (
        typing &&
        left <= line.length &&
        left >= 0 &&
        blink &&
        (left < line.length || li === lay.cmds[i]!.length - 1)
      ) {
        c.fillStyle = COL.lime
        c.fillRect(x0 + chW * (2 + shown.length), y - size * 0.82, chW * 0.6, size * 1.0)
      }
      left -= line.length + 1
      y += lh
    })
    let n = v.shown
    for (const o of row.out) {
      const lines = wrapMono(o, Math.floor((z.w - TERM_PAD * 2) / chW))
      if (n <= 0) break
      n -= 1
      const col = /^(?:Successfully|Done|Finished|Installed|v?\d)/.test(o)
        ? COL.lime
        : 'rgba(246,244,238,0.55)'
      for (const l of lines) {
        text(c, l, x0, y, 'mono', size, col)
        y += lh
      }
    }
    y += size * 0.3
  })
  const done = reveal.every(
    (v, i) => v.typed >= lay.rows[i]!.cmd.length && v.shown >= lay.rows[i]!.out.length,
  )
  if (done) {
    text(c, '$', x0, y, 'monoB', size, COL.lime)
    if (blink) {
      c.fillStyle = COL.lime
      c.fillRect(x0 + chW * 2, y - size * 0.82, chW * 0.6, size)
    }
  }
  c.restore()
}

function drawTermFooter(a: DrawArgs, lay: TermLay, z: ReturnType<typeof zone>): void {
  const { c, t } = a
  let y = z.y + lay.termH + 28
  if (lay.facts.length) {
    let x = z.x
    lay.facts.forEach((f, i) => {
      const p = eo(pr(t, 0.3 + i * 0.08, 0.45))
      c.save()
      c.globalAlpha = p
      x += pill(c, f, x, y + (1 - p) * 16, 30, { fill: 'rgba(246,244,238,0.08)' }) + 14
      c.restore()
    })
    y += 70
  }
  if (lay.descLay)
    riseLines(
      c,
      lay.descLay.lines,
      z.x,
      y - 8,
      'bold',
      lay.descLay.size,
      'rgba(246,244,238,0.78)',
      t,
      0.5,
      {
        lh: 1.25,
        step: 0.03,
      },
    )
}

/* -------------------------------- CodeBlock -------------------------------- */

function codeOf(a: DrawArgs) {
  const code = prop<string>(a.shot.props, 'code', '').replace(/\s+$/, '')
  return { code, language: prop<string>(a.shot.props, 'language', 'text') }
}

export const CodeBlock: Screen = {
  draw(a) {
    const { code } = codeOf(a)
    if (!code.trim()) return fallback.draw(a)
    if (isShortCode(code.split('\n'))) return drawCodeCard(a)
    drawCodeEditor(a)
  },
}

function drawCodeCard(a: DrawArgs): void {
  const { c, t } = a
  page(a)
  const z = zone(a)
  const { code, language } = codeOf(a)
  const lines = cardLines(code, language)
  const cols = Math.max(...lines.map((l) => l.length), 1)
  const size = Math.max(40, Math.min(120, Math.floor((z.w - 100) / (cols * 0.62))))
  const lh = size * 1.35
  const cardH = lines.length * lh + 128
  const label = codeKind(language)
  const top = z.y + Math.max(0, (z.h - cardH - 110) / 2)
  const [pa, pd] = slide(pr(t, 0, 0.5), 20)
  c.save()
  c.globalAlpha = pa
  pill(c, label.toUpperCase(), z.x, top + pd, 30, { fill: COL.lime, fg: COL.limeInk })
  c.restore()
  const [ca, cd] = slide(pr(t, 0.08, 0.6), 50)
  const y = top + 110 + cd
  c.save()
  c.globalAlpha = Math.min(1, ca * 1.3)
  card(c, z.x, y, z.w, cardH, { r: 28, fill: '#0d0d11' })
  rrect(c, z.x, y + 24, 10, cardH - 48, 5)
  c.fillStyle = COL.lime
  c.fill()
  lines.forEach((line, i) => {
    const toks = tokenize(line)
    const w = toks.reduce((s, k) => s + measure(k.text, 'mono', size), 0)
    drawTokens(c, toks, z.x + (z.w - w) / 2 + 5, y + 64 + size * 0.85 + i * lh, size)
  })
  c.restore()
}

type EditorLay = {
  size: number
  rows: Token[][][]
  lineH: number
  head: number
  foot: number
  h: number
}

function layoutEditor(a: DrawArgs, lines: string[], code: string): EditorLay {
  const z = zone(a)
  const head = 76
  const foot = 72
  const gutter = 66
  const innerW = z.w - 40 - gutter - 24
  const few = lines.length <= 2
  void code
  const room = z.h - head - foot - 40
  const tryRows = (size: number) => {
    const cols = Math.floor(innerW / monoW(size))
    const rows = lines.map((l) => tokenRows(tokenize(l), cols))
    const count = rows.reduce((n, r) => n + r.length, 0)
    return { rows, fits: count * size * 1.5 <= room, wrapped: rows.some((r) => r.length > 1) }
  }
  let size = 52
  let rows: Token[][][] = []
  const pick = (from: number, to: number, allowWrap: boolean) => {
    for (let s = from; s >= to; s -= 1) {
      const r = tryRows(s)
      if (r.fits && (allowWrap || !r.wrapped)) {
        size = s
        rows = r.rows
        return true
      }
    }
    return false
  }
  if (!pick(52, 26, false) && !pick(38, 18, true)) {
    size = 18
    rows = tryRows(18).rows
  }
  const count = rows.reduce((n, r) => n + r.length, 0)
  const body = count * size * 1.5 + 44
  const h = Math.min(z.h, head + foot + (few ? Math.max(body, 280) : body))
  return { size, rows, lineH: size * 1.5, head, foot, h }
}

function drawCodeEditor(a: DrawArgs): void {
  const { c, t } = a
  page(a)
  const z = zone(a)
  const { code, language } = codeOf(a)
  const lines = code.split('\n')
  const lay = a.memo('lay', () => layoutEditor(a, lines, code))
  const top = z.y + (z.h - lay.h) * (lines.length <= 2 ? 0.5 : 0.25)
  const [al, dy] = slide(pr(t, 0, 0.55), 40)
  c.save()
  c.globalAlpha = Math.min(1, al * 1.3)
  c.translate(0, dy)
  card(c, z.x, top, z.w, lay.h, { r: 28, fill: '#0d0d11' })
  c.save()
  rrect(c, z.x, top, z.w, lay.h, 28)
  c.clip()
  c.fillStyle = '#15151a'
  c.fillRect(z.x, top, z.w, lay.head)
  c.fillStyle = COL.lime
  c.fillRect(z.x + 20, top, measure(`snippet.${ext(language)}`, 'mono', 28) + 56, 4)
  text(c, `snippet.${ext(language)}`, z.x + 48, top + 47, 'mono', 28, COL.white)
  c.fillStyle = HAIR
  c.fillRect(z.x, top + lay.head, z.w, 1.5)
  const shown = Math.min(lines.length, 1 + Math.floor(Math.max(0, t - 0.06) / 0.14))
  let y = top + lay.head + 24
  const gx = z.x + 20 + 54
  const tx = z.x + 20 + 66
  lines.forEach((_, i) => {
    const rows = lay.rows[i]!
    if (i >= shown) return
    const active = i === shown - 1 && shown < lines.length + 1
    if (active) {
      c.fillStyle = 'rgba(200,247,81,0.07)'
      c.fillRect(z.x + 8, y + 2, z.w - 16, rows.length * lay.lineH)
      c.fillStyle = COL.lime
      c.fillRect(z.x + 8, y + 2, 4, rows.length * lay.lineH)
    }
    text(c, String(i + 1), gx, y + lay.size * 1.12, 'mono', lay.size * 0.8, '#55555e', {
      align: 'right',
    })
    rows.forEach((row, ri) =>
      drawTokens(c, row, tx, y + lay.size * 1.12 + ri * lay.lineH, lay.size),
    )
    y += rows.length * lay.lineH
  })
  const fy = top + lay.h - lay.foot / 2 + 8
  text(c, language, z.x + 28, fy, 'mono', 26, 'rgba(246,244,238,0.45)')
  text(
    c,
    `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`,
    z.x + z.w - 28,
    fy,
    'mono',
    26,
    'rgba(246,244,238,0.45)',
    {
      align: 'right',
    },
  )
  c.restore()
  c.restore()
}

const ext = (language: string) => EXT[language.toLowerCase()] ?? language.toLowerCase()

/* -------------------------------- RepoDemo -------------------------------- */

const DEMO_PUSH = 0.05
const windowOf = (a: Pick<DrawArgs, 'shot'>) => {
  const z = zone(a)
  return { x: z.x, y: z.y, w: z.w, h: Math.min(1110, ZONE_BOTTOM - z.y - 6) }
}

let softCanvas: Canvas | null = null

export const RepoDemo: Screen = {
  video(shot, reel) {
    const demo = reel.ctx.demo
    if (!demo) return null
    const offset = Math.min(
      prop<number>(shot.props, 'offset', 0),
      Math.max(0, demo.seconds - shot.dur),
    )
    const { w, h } = demoDecodeSize(demo)
    return { src: demo.src, at: offset, frames: Math.ceil(shot.dur * FPS), w, h, mode: 'fit' }
  },
  draw(a) {
    const { c, t, shot } = a
    const demo = a.ctx.demo
    if (!demo) return fallback.draw(a)
    page(a, { backdrop: 0.3 })
    const vid = a.media.video()
    if (vid) {
      softCanvas ??= createCanvas(54, 96)
      paintSoft(c, softCanvas, vid, 0.58)
    }
    const win = windowOf(a)
    const crops = a.memo('crops', () => demoCrops(demo, win.w, win.h))
    const only = shot.props.part === 0 || shot.props.part === 1 ? shot.props.part : null
    const split = only === null ? shot.dur * 0.5 : only === 0 ? shot.dur : 0
    const second = t >= split
    const part = crops[second ? 1 : 0]
    const len = Math.max(0.1, second ? shot.dur - split : split)
    const p = eio(Math.min(1, (second ? t - split : t) / len))
    const at = { x: mix(part.from.x, part.to.x, p), y: mix(part.from.y, part.to.y, p) }
    const punch = second && only === null ? 0.96 + 0.04 * pr(t, split, 0.2) : 1
    const enter = eo(pr(t, 0, 0.5))
    c.save()
    c.globalAlpha = Math.min(1, enter * 1.4)
    c.translate(win.x + win.w / 2, win.y + win.h / 2 + (1 - enter) * 40)
    c.scale(punch, punch)
    c.translate(-win.w / 2, -win.h / 2)
    rrect(c, 0, 0, win.w, win.h, 26)
    c.fillStyle = '#000'
    c.fill()
    c.save()
    rrect(c, 0, 0, win.w, win.h, 26)
    c.clip()
    if (vid) {
      const k = 1 + DEMO_PUSH * p
      c.translate(at.x, at.y)
      c.scale(k, k)
      c.drawImage(vid, 0, 0, part.videoWidth, part.videoHeight)
    }
    c.restore()
    rrect(c, 0.75, 0.75, win.w - 1.5, win.h - 1.5, 26)
    c.strokeStyle = 'rgba(246,244,238,0.14)'
    c.lineWidth = 1.5
    c.stroke()
    const { owner, name } = repoIdentity(a.ctx)
    const label = owner && name ? `github.com/${owner}/${name}` : a.ctx.domain
    drawDemoTag(c, label, 22, 22)
    c.restore()
  },
}

function drawDemoTag(c: Ctx, label: string, x: number, y: number): void {
  const tag = `Demo · ${label.length > 36 ? `${label.slice(0, 35)}…` : label}`
  const w = measure(tag, 'monoB', 26) + 62
  card(c, x, y, w, 56, { r: 28, fill: 'rgba(11,11,14,0.78)', stroke: 'rgba(246,244,238,0.14)' })
  c.beginPath()
  c.arc(x + 28, y + 28, 7, 0, Math.PI * 2)
  c.fillStyle = COL.lime
  c.fill()
  text(c, tag, x + 46, y + 37, 'monoB', 26, COL.white)
}
