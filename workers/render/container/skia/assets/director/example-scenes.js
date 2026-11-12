// The eleven scenes. Every scene: (t, lt, X) with t = absolute seconds, lt = local seconds.
// Times are snapped to the narration's word starts (props.words), so type lands ON the spoken word.
import { Path2D } from '@napi-rs/canvas'
import { S, W, H, COL, clamp, pr, eo, eo3, eo4, ei4, eio, eb, mix, text, measure, fit, rise, riseChars, rrect, icon, iconPart, gemini, stroke, font } from './lib.mjs'

const { ink, bone, lime, coral, white, dim } = COL
const bg = (col) => { S.c.fillStyle = col; S.c.fillRect(0, 0, W, H) }
const L = 96, CW = 810 // left margin, content width

// ---------- video helper: cover-scaled, push-in, about a pivot ----------
function video(vc, scale, px = W / 2, py = H / 2, ox = 0, oy = 0) {
  const c = S.c
  c.save(); c.translate(px + ox, py + oy); c.scale(scale * 1.5, scale * 1.5); c.translate(-px / 1.5, -py / 1.5)
  c.imageSmoothingQuality = 'low'
  c.drawImage(vc, 0, 0)
  c.restore()
}

function backVideo(vc, push, a) {
  if (!vc) return
  const c = S.c
  c.save(); c.globalAlpha = a; video(vc, push); c.restore()
}

// ---------- shared price-bar illustration (hook + callback in S10) ----------
function barRow(x, y, w, h, frac, color, ticks) {
  const c = S.c
  const bw = w * frac
  if (bw < 1) return
  rrect(x, y, bw, h, 10); c.fillStyle = color; c.fill()
  if (ticks) {
    c.fillStyle = ink
    for (let i = 1; i < 4; i++) { const tx = x + (w * i) / 4; if (tx < x + bw - 3) c.fillRect(tx - 2, y, 4, h) }
  }
}

// ===================================================================================
// S1  HOOK  0 - 5.55   ink.  Kinetic title -> "4x" -> price bars.  (words are the captions)
// ===================================================================================
export function s1(t, lt, X) {
  const c = S.c
  bg(ink)
  // the real source: blurred backdrop + the thumbnail contained in a card (like the baseline opening)
  c.drawImage(X.backdrop, 0, 0)
  const ce = eo(pr(t, 0, 0.5))
  const cardW = CW, cardH = Math.round((CW * 720) / 1280), cardX = L, cardY = 520
  c.save()
  c.translate(0, (1 - ce) * 140); c.globalAlpha = Math.min(1, ce * 2.5)
  rrect(cardX + 6, cardY + 18, cardW, cardH, 26); c.fillStyle = 'rgba(0,0,0,0.45)'; c.fill()
  rrect(cardX, cardY, cardW, cardH, 26); c.clip()
  const k = 1 + 0.07 * eo3(pr(t, 0, 5.4)), px = cardX + cardW * 0.7, py = cardY + cardH * 0.45
  c.translate(px, py); c.scale(k, k); c.translate(-px, -py)
  c.drawImage(X.img, cardX, cardY, cardW, cardH)
  c.restore()
  // brand mark spins in on "Google's"
  const pm = pr(t, 0.1, 0.8)
  if (pm > 0) { c.save(); c.translate(L + 44, 350); c.rotate((1 - eo(pm)) * -1.6); const kk = eb(pm, 1.9); c.scale(kk, kk); gemini(-44, -44, 88, lime); c.restore() }
  rise("GOOGLE'S", L + 120, 364, 30, 'MonoB', white, t, 0.1, { ls: 0.14 })
  // title: one tight line, word by word
  const ls = -0.035
  const ts = fit('GEMINI 4 CARBON', 'BrikX', CW, 120, 60, ls)
  const sp = measure(' ', 'BrikX', ts, ls)
  const w1 = rise('GEMINI', L, 470, ts, 'BrikX', white, t, 0.56, { ls, dur: 0.55 })
  const w2 = rise('4', L + w1 + sp, 470, ts, 'BrikX', lime, t, 1.01, { ls, dur: 0.5 })
  rise('CARBON', L + w1 + w2 + 2 * sp, 470, ts, 'BrikX', white, t, 1.3, { ls, dur: 0.55 })
  // 4x: the number is the headline, over the lower part of the card
  rise('4', L - 6, 1210, 260, 'BrikX', lime, t, 1.91, { ls: -0.04, dur: 0.6 })
  rise('×', L + 150, 1210, 260, 'BrikX', white, t, 2.15, { ls: -0.04, dur: 0.6 })
  riseChars('CHEAPER', 520, 1210, 88, 'BrikX', white, t, 2.56, { step: 0.03, ls: -0.02 })
  rise('than', L, 1290, 60, 'SerifI', dim, t, 2.94, { dur: 0.45 })
  const bx = L, bw = CW
  rise('FABLE', bx + 150, 1290, 28, 'MonoB', coral, t, 3.09, { ls: 0.1 })
  rise('5.2', bx + 150 + measure('FABLE ', 'MonoB', 28, 0.1), 1290, 28, 'MonoB', coral, t, 3.46, { ls: 0.1 })
  barRow(bx, 1306, bw, 52, eo(pr(t, 3.09, 0.7)), coral, true)
  rise('GEMINI 4 CARBON', bx, 1402, 28, 'MonoB', lime, t, 3.85, { ls: 0.1, dur: 0.4 })
  barRow(bx, 1416, bw, 52, 0.25 * eo(pr(t, 3.85, 0.5)), lime, false)
  const pgu = eo(pr(t, 4.3, 0.35))
  if (pgu > 0) {
    c.save(); c.setLineDash([8, 8]); c.strokeStyle = white; c.globalAlpha = 0.7; c.lineWidth = 3
    c.beginPath(); c.moveTo(bx + bw * 0.25, 1416); c.lineTo(bx + bw * 0.25, 1416 - 70 * pgu); c.stroke(); c.restore()
  }
  icon('clock', bx + bw * 0.25 + 26, 1422, 40, pr(t, 4.74, 0.45), lime, 2.2)
  rise('FOR NOW', bx + bw * 0.25 + 78, 1452, 28, 'MonoB', lime, t, 4.88, { ls: 0.1 })
}

// ===================================================================================
// S2  5.55 - 8.6   neon-circuit b-roll graded to brand lime; "FRONTIER MODEL" is a knock-out
// ===================================================================================
export function s2(t, lt, X) {
  const c = S.c
  bg(ink)
  const push = 1 + 0.16 * eo3(pr(lt, 0, 3.05))
  const vc = X.vid(2)
  if (vc) {
    video(vc, push)
    c.fillStyle = 'rgba(11,11,14,0.62)'; c.fillRect(0, 0, W, H)
  }
  rise('CARBON', L, 760, 34, 'MonoB', lime, t, 6.12, { ls: 0.14 })
  rise('IS', L + measure('CARBON ', 'MonoB', 34, 0.14), 760, 34, 'MonoB', white, t, 6.54, { ls: 0.14 })
  rise("Google's", L, 880, 110, 'SerifI', white, t, 6.67, { dur: 0.55 })
  rise('NEWEST', L, 1040, 150, 'BrikX', white, t, 7.1, { ls: -0.03, dur: 0.55 })
  // knock-out words: the footage lives inside the letters
  const k = X.layer(1), kc = k.getContext('2d')
  const y0 = 1040, hh = 520
  kc.clearRect(0, y0, W, hh)
  const prev = S.c
  S.c = kc
  const sz = fit('FRONTIER', 'BrikX', CW, 190, 80, -0.035)
  rise('FRONTIER', L, 1040 + sz * 0.98, sz, 'BrikX', '#fff', t, 7.51, { ls: -0.035, dur: 0.6 })
  rise('MODEL', L, 1040 + sz * 1.96, sz, 'BrikX', '#fff', t, 7.97, { ls: -0.035, dur: 0.6 })
  if (vc) {
    kc.save(); kc.globalCompositeOperation = 'source-in'; kc.beginPath(); kc.rect(0, y0, W, hh); kc.clip()
    kc.filter = 'brightness(1.9) contrast(1.1)'
    video(vc, push)  // draws on kc because S.c === kc
    kc.globalCompositeOperation = 'source-atop'; kc.filter = 'none'; kc.fillStyle = 'rgba(200,247,81,0.5)'; kc.fillRect(0, y0, W, hh)
    kc.restore()
  } else { kc.save(); kc.globalCompositeOperation = 'source-in'; kc.fillStyle = lime; kc.fillRect(0, y0, W, hh); kc.restore() }
  S.c = prev
  c.drawImage(k, 0, y0, W, hh, 0, y0, W, hh)
  // carrier: the hook's lime bar (96,1386,202x64) arrives at the same place, then becomes the underline
  const pc = eo(pr(t, 8.1, 0.5))
  const bh = mix(52, 9, pc), by = mix(1416, 1040 + sz * 1.96 + 26, pc), bwid = mix(202.5, CW, pc)
  rrect(L, by, bwid, bh, 6); c.fillStyle = lime; c.fill()
}

// ===================================================================================
// S3  8.6 - 13.7   bone.  A lime row climbs a leaderboard to rank 1.  Header words swap by masked rise.
// ===================================================================================
const slotY = (i) => 660 + i * 118
export function s3(t) {
  const c = S.c
  bg(bone)
  // phase A header
  rise('for', L, 470, 150, 'SerifI', ink, t, 8.84, { dur: 0.6, out: 10.62, outDur: 0.28 })
  const fw = measure('for ', 'SerifI', 150)
  rise('a', L + fw, 470, 150, 'SerifI', ink, t, 9.05, { dur: 0.6, out: 10.66, outDur: 0.28 })
  const aw = measure('for a ', 'SerifI', 150)
  rise('while', L + aw, 470, 150, 'SerifI', ink, t, 9.14, { dur: 0.6, out: 10.7, outDur: 0.28 })
  // phase B header (the benchmark name, word by word)
  const hs = fit('ARTIFICIAL ANALYSIS', 'BrikX', CW, 84, 40, -0.03)
  const ax = rise('ARTIFICIAL', L, 440, hs, 'BrikX', ink, t, 10.86, { ls: -0.03, dur: 0.5 })
  rise('ANALYSIS', L + ax + measure(' ', 'BrikX', hs, -0.03), 440, hs, 'BrikX', ink, t, 11.51, { ls: -0.03, dur: 0.5 })
  const ix = rise('INTELLIGENCE', L, 440 + hs * 1.02, hs, 'BrikX', ink, t, 12.06, { ls: -0.03, dur: 0.5 })
  rise('INDEX', L + ix + measure(' ', 'BrikX', hs, -0.03), 440 + hs * 1.02, hs, 'BrikX', ink, t, 12.71, { ls: -0.03, dur: 0.5 })
  // rows
  const climb = eio(pr(t, 9.62, 0.64)) // lime row: slot 4 -> 0, arrives on "spot"
  const sL = 4 - 4 * climb
  const rows = []
  for (let j = 0; j < 4; j++) rows.push({ j, slot: j + clamp(j + 1 - sL, 0, 1), lime: false })
  rows.push({ j: 4, slot: sL, lime: true })
  rows.sort((a, b) => Number(a.lime) - Number(b.lime))
  for (const r of rows) {
    const enter = eo(pr(t, 9.15 + r.j * 0.07, 0.55))
    if (enter <= 0) continue
    const y = slotY(r.slot) + (1 - enter) * 160
    const rank = Math.round(r.slot) + 1
    c.save(); c.globalAlpha = Math.min(1, enter * 1.8)
    const lift = r.lime ? clamp(climb * (1 - climb) * 4, 0, 1) : 0
    if (r.lime) {
      rrect(L + 6, y + 12 + lift * 8, CW, 100, 22); c.fillStyle = 'rgba(11,11,14,0.16)'; c.fill()
      rrect(L, y - lift * 6, CW, 100, 22); c.fillStyle = lime; c.fill()
      text(`#${rank}`, L + 30, y + 68 - lift * 6, 'BrikX', 54, ink, { ls: -0.03 })
      gemini(L + 150, y + 26 - lift * 6, 48, ink)
      text('GEMINI 4 CARBON', L + 218, y + 64 - lift * 6, 'BrikB', 40, ink, { ls: -0.02 })
      icon('trophy', L + CW - 96, y + 18 - lift * 6, 64, pr(t, 10.26, 0.6), ink, 1.8)
    } else {
      rrect(L, y, CW, 100, 22); c.fillStyle = 'rgba(11,11,14,0.07)'; c.fill()
      text(`#${rank}`, L + 30, y + 64, 'MonoB', 34, 'rgba(11,11,14,0.4)')
      rrect(L + 150, y + 30, 240 + (r.j * 53) % 160, 14, 7); c.fillStyle = 'rgba(11,11,14,0.14)'; c.fill()
      rrect(L + 150, y + 56, 140 + (r.j * 71) % 120, 14, 7); c.fillStyle = 'rgba(11,11,14,0.09)'; c.fill()
    }
    c.restore()
  }
}

// ===================================================================================
// S4  13.7 - 17.7   ink.  Three steps; a lime marker climbs to the top tier; the lock opens.
// ===================================================================================
export function s4(t, lt, X) {
  const c = S.c
  bg(ink)
  backVideo(X.vid(4), 1 + 0.12 * eo3(pr(lt, 0, 4)), 0.34)
  rise('YOU NEED', L, 340, 34, 'MonoB', dim, t, 14.22, { ls: 0.14 })
  rise('ULTRA', L, 540, fit('ULTRA', 'BrikX', CW - 120, 210, 90, -0.04), 'BrikX', lime, t, 14.8, { ls: -0.04, dur: 0.6 })
  riseChars('SUBSCRIPTION', L, 640, 34, 'MonoB', white, t, 15.14, { step: 0.04, ls: 0.12, dur: 0.35 })
  // stairs: waterfall rise from the baseline
  const base = 1300, sw = 258, gap = 18
  const hs = [200, 400, 600]
  const xs = [L, L + sw + gap, L + 2 * (sw + gap)]
  const top = (i) => base - hs[i]
  for (let i = 0; i < 3; i++) {
    const p = eo(pr(t, 14.9 + i * 0.12, 0.6))
    if (p <= 0) continue
    const h = hs[i] * p
    const filled = i === 2 ? eo(pr(t, 16.6, 0.3)) : 0
    rrect(xs[i], base - h, sw, h + 40, 18); c.fillStyle = filled > 0 ? lime : '#1b1b21'; c.fill()
    if (!filled) { rrect(xs[i] + 1.5, base - h + 1.5, sw - 3, h + 40, 17); c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 3; c.stroke() }
    text(`0${i + 1}`, xs[i] + 26, base - h + 62, 'MonoB', 34, filled > 0 ? ink : dim)
  }
  // lock on the top step
  const lp = pr(t, 15.3, 0.55)
  if (lp > 0) {
    const lx = xs[2] + sw / 2 - 40, ly = top(2) - 118
    const open = eb(pr(t, 16.62, 0.4), 2.2)
    c.save(); c.translate(lx, ly); c.scale(80 / 24, 80 / 24)
    c.strokeStyle = white; c.lineWidth = 1.8; c.lineCap = 'round'; c.lineJoin = 'round'
    c.setLineDash(lp >= 1 ? [] : [60 * lp, 200]); c.stroke(iconPart('lock', 0))
    c.save(); c.translate(17, 11); c.rotate(-0.4 * open); c.translate(-17, -11 - 3 * open); c.stroke(iconPart('lock', 1)); c.restore()
    c.restore()
  }
  // marker: stands on step 1, hops to 2, hops to 3 ("highest tier"), lands with a ring
  const r = 32
  const mp = (i) => [xs[i] + sw / 2, top(i) - r]
  const drop = eb(pr(t, 15.55, 0.35), 1.4)
  let [mx, my] = mp(0)
  let sx = 1, sy = 1
  if (t >= 16.14) {
    const a = eio(pr(t, 16.14, 0.26)), b = eio(pr(t, 16.38, 0.26))
    const [x1, y1] = mp(0), [x2, y2] = mp(1), [x3, y3] = mp(2)
    if (t < 16.38) { mx = mix(x1, x2, a); my = mix(y1, y2, a) - Math.sin(a * Math.PI) * 140; const v = Math.sin(a * Math.PI); sx = 1 - 0.14 * v; sy = 1 + 0.2 * v }
    else { mx = mix(x2, x3, b); my = mix(y2, y3, b) - Math.sin(b * Math.PI) * 140; const v = Math.sin(b * Math.PI); sx = 1 - 0.14 * v; sy = 1 + 0.2 * v
      if (b >= 1) { const q = pr(t, 16.64, 0.14); sx = 1 + 0.18 * Math.sin(q * Math.PI); sy = 1 - 0.18 * Math.sin(q * Math.PI) } }
  } else my -= (1 - drop) * 320
  if (t > 15.55) {
    c.save(); c.translate(mx, my + r); c.scale(sx, sy); c.translate(0, -r)
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = lime; c.fill()
    c.beginPath(); c.arc(0, 0, r * 0.38, 0, Math.PI * 2); c.fillStyle = ink; c.fill()
    c.restore()
  }
  for (let k = 0; k < 2; k++) {
    const q = pr(t, 16.64 + k * 0.1, 0.55)
    if (q > 0 && q < 1) {
      const [x3, y3] = mp(2)
      c.beginPath(); c.arc(x3, y3 + r, 40 + 150 * eo(q), 0, Math.PI * 2)
      c.strokeStyle = lime; c.globalAlpha = (1 - q) * 0.9; c.lineWidth = 6 * (1 - q) + 1; c.stroke(); c.globalAlpha = 1
    }
  }
}

// ===================================================================================
// S5  17.7 - 20.0   lime.  Thinking-level slider: probes the range, settles on the default.
// ===================================================================================
export function s5(t) {
  const c = S.c
  bg(lime)
  icon('brain', L - 6, 330, 124, pr(t, 17.84, 0.7), ink, 1.5)
  const pq = eb(pr(t, 18.09, 0.4), 1.8)
  if (pq > 0) {
    c.save(); c.translate(L + 190, 392); c.scale(pq, pq)
    rrect(0, -34, 200, 52, 26); c.fillStyle = ink; c.fill()
    text('DEFAULT', 100, 2, 'MonoB', 28, lime, { ls: 0.14, align: 'center' })
    c.restore()
  }
  const ts = fit('THINKING', 'BrikX', CW, 170, 80, -0.04)
  rise('THINKING', L, 640, ts, 'BrikX', ink, t, 18.54, { ls: -0.04, dur: 0.55 })
  rise('LEVEL', L, 640 + ts * 0.98, ts, 'BrikX', ink, t, 18.88, { ls: -0.04, dur: 0.55 })
  // slider
  const ty = 1010, seg = 250, g = 30
  const sx = (i) => L + i * (seg + g)
  const labels = ['LOW', 'MEDIUM', 'HIGH']
  for (let i = 0; i < 3; i++) {
    const p = eo(pr(t, 18.8 + i * 0.07, 0.4))
    if (p <= 0) continue
    rrect(sx(i), ty - 12, seg * p, 24, 12); c.fillStyle = i === 1 && t >= 19.4 ? ink : 'rgba(11,11,14,0.2)'; c.fill()
    rise(labels[i], sx(i), ty + 70, 28, 'MonoB', ink, t, 18.9 + i * 0.07, { ls: 0.12, dur: 0.35 })
  }
  const kx = (i) => sx(i) + seg / 2
  let k = kx(0)
  if (t < 19.32) k = mix(kx(0), kx(2), eio(pr(t, 18.98, 0.34)))
  else k = mix(kx(2), kx(1), eb(pr(t, 19.32, 0.4), 1.5))
  if (t > 18.9) {
    c.beginPath(); c.arc(k, ty, 46, 0, Math.PI * 2); c.fillStyle = ink; c.fill()
    c.beginPath(); c.arc(k, ty, 16, 0, Math.PI * 2); c.fillStyle = lime; c.fill()
  }
  const ms = fit('MEDIUM', 'BrikX', CW, 230, 90, -0.04)
  rise('MEDIUM', L, 1380, ms, 'BrikX', ink, t, 19.32, { ls: -0.04, dur: 0.55 })
}

// ===================================================================================
// S6  20.0 - 23.0   ink.  A context window fills, brims, overflows; the counter lands on "tokens".
// ===================================================================================
const COLS = 34, ROWS = 26, PITCH = 24
const spill = Array.from({ length: 150 }, (_, i) => {
  const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(i * 78.233) * 12345.678) % 1, r3 = Math.abs(Math.sin(i * 4.1414) * 999.9) % 1
  return { col: Math.floor(r1 * COLS), tx: r2, ty: r3, d: r1 * 0.3 }
})
export function s6(t, lt, X) {
  const c = S.c
  bg(ink)
  backVideo(X.vid(6), 1 + 0.1 * eo3(pr(lt, 0, 3)), 0.2)
  const gx = 108, gy = 600, fx = 84, fy = 574
  const fw = COLS * PITCH + 24, fh = ROWS * PITCH + 24
  // counter
  const cnt = Math.round(1000000 * eio(pr(t, 21.2, 0.86)))
  if (t >= 21.2) {
    const s = cnt.toLocaleString('en-US')
    const cs = fit('1,000,000', 'MonoB', CW - 80, 140, 60)
    text(s, L - 4, 440, 'MonoB', cs, lime, { ls: -0.04 })
    const pp = eb(pr(t, 22.07, 0.35), 2.2)
    if (pp > 0) { c.save(); const px = L - 4 + measure('1,000,000', 'MonoB', cs, -0.04) + 20; c.translate(px, 440); c.scale(pp, pp); text('+', 0, 0, 'MonoB', cs, white); c.restore() }
  }
  rise('CONTEXT', L, 520, 34, 'MonoB', white, t, 20.27, { ls: 0.14 })
  rise('WINDOW', L + measure('CONTEXT ', 'MonoB', 34, 0.14), 520, 34, 'MonoB', white, t, 20.88, { ls: 0.14 })
  rise('TOKENS', L + 560, 520, 34, 'MonoB', lime, t, 22.07, { ls: 0.14 })
  // frame draws on
  const pf = eo(pr(t, 20.27, 0.6))
  stroke([[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh]], pf, 'rgba(255,255,255,0.55)', 4, { close: true })
  // cells
  const total = COLS * ROWS
  const fillN = Math.floor(total * eo(pr(t, 20.88, 0.55)))
  const cells = new Path2D(), on = new Path2D()
  for (let i = 0; i < total; i++) {
    const x = gx + (i % COLS) * PITCH, y = gy + Math.floor(i / COLS) * PITCH
    ;(i < fillN ? on : cells).roundRect(x, y, 16, 16, 4)
  }
  if (pf > 0.5) { c.fillStyle = 'rgba(255,255,255,0.09)'; c.fill(cells); c.fillStyle = lime; c.fill(on) }
  // overflow: tokens spill out of the bottom edge
  for (const s of spill) {
    const p = eo(pr(t, 21.3 + s.d, 0.7))
    if (p <= 0) continue
    const x0 = gx + s.col * PITCH, y0 = gy + (ROWS - 1) * PITCH
    const x = mix(x0, fx + 20 + s.tx * (fw - 60), p), y = mix(y0, fy + fh + 30 + s.ty * 190, p)
    c.fillStyle = lime; c.globalAlpha = 0.95 - 0.5 * s.ty
    c.beginPath(); c.roundRect(x, y, 14, 14, 4); c.fill(); c.globalAlpha = 1
  }
}

// ===================================================================================
// S7  23.0 - 25.45   keyboard b-roll (apartment plant, hands at work); title; the carrier rect closes in
// ===================================================================================
export const PLAN = { x: 130, y: 440, w: 820, h: 700 }
export function s7(t, lt, X) {
  const c = S.c
  bg(ink)
  const push = 1 + 0.12 * eo3(pr(lt, 0, 2.45))
  const vc = X.vid(7)
  if (vc) video(vc, push, W / 2, 760)
  const g = c.createLinearGradient(0, 700, 0, 1700)
  g.addColorStop(0, 'rgba(11,11,14,0)'); g.addColorStop(0.55, 'rgba(11,11,14,0.78)'); g.addColorStop(1, 'rgba(11,11,14,0.9)')
  c.fillStyle = g; c.fillRect(0, 700, W, 1000)
  rise('ON THE', L, 1218, 34, 'MonoB', lime, t, 23.61, { ls: 0.14 })
  const a = fit("JERRY'S", 'BrikX', CW, 190, 80, -0.04)
  rise("JERRY'S", L, 1218 + a * 0.84, a, 'BrikX', white, t, 23.91, { ls: -0.04, dur: 0.55 })
  const b = fit('APARTMENT', 'BrikX', CW, 150, 60, -0.04)
  rise('APARTMENT', L, 1218 + a * 0.84 + b * 0.95, b, 'BrikX', white, t, 24.3, { ls: -0.04, dur: 0.55 })
  rise('TEST', L, 1218 + a * 0.84 + b * 0.95 + 118, 118, 'BrikX', lime, t, 24.77, { ls: -0.04, dur: 0.55 })
  // carrier: lime wall rectangle drawn over the footage (it is S8's outer wall)
  const p = eo(pr(t, 24.9, 0.45))
  stroke([[PLAN.x, PLAN.y], [PLAN.x + PLAN.w, PLAN.y], [PLAN.x + PLAN.w, PLAN.y + PLAN.h], [PLAN.x, PLAN.y + PLAN.h]], p, lime, 7, { close: true })
}

// ===================================================================================
// S8  25.45 - 31.6   blueprint.  Plan draws; replica slides into register; the hallway cannot exist.
// ===================================================================================
const P = PLAN
const plan = {
  walls: [
    [[480, 0], [480, 250]], [[480, 370], [480, 700]],
    [[480, 330], [600, 330]], [[700, 330], [820, 330]],
    [[190, 0], [190, 230], [60, 230]],
  ],
  furn: [[[230, 500], [430, 500], [430, 580], [230, 580]], [[230, 300], [350, 300], [350, 420], [230, 420]],
    [[600, 50], [770, 50], [770, 250], [600, 250]], [[660, 420], [800, 420], [800, 660], [660, 660]]],
  hallA: [[150, 700], [150, 150], [640, 150]], hallB: [[230, 700], [230, 230], [640, 230]],
}
let gridSprite = null
export function s8(t, lt, X) {
  const c = S.c
  bg(ink)
  if (!gridSprite) {
    gridSprite = X.mk(W, H, (g) => { g.strokeStyle = 'rgba(200,247,81,0.07)'; g.lineWidth = 1; for (let x = 0; x <= W; x += 54) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() } for (let y = 0; y <= H; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() } })
  }
  c.drawImage(gridSprite, 0, 0)
  c.save(); c.translate(P.x, P.y)
  // reference plan (ghost) and the replica
  const gh = eo(pr(t, 25.5, 0.5))
  const slide = 1 - eo(pr(t, 26.46, 0.5))
  const off = [34 * slide, -26 * slide]
  const ghostC = 'rgba(246,244,238,0.22)'
  const all = [...plan.walls, ...plan.furn]
  for (const pts of plan.walls) stroke(pts, gh, ghostC, 5)
  for (const pts of plan.furn) stroke(pts, gh, ghostC, 3, { close: true })
  stroke([[0, 0], [P.w, 0], [P.w, P.h], [0, P.h]], 1, 'rgba(246,244,238,0.22)', 5, { close: true })
  // the outer wall is the carrier from S7: already complete, and slides with the replica
  stroke([[0, 0], [P.w, 0], [P.w, P.h], [0, P.h]], 1, lime, 7, { close: true, dx: off[0], dy: off[1] })
  all.forEach((pts, i) => {
    const p = eo(pr(t, 25.62 + i * 0.07, 0.5))
    const isFurn = i >= plan.walls.length
    stroke(pts, p, isFurn ? 'rgba(200,247,81,0.65)' : lime, isFurn ? 3.5 : 6, { dx: off[0], dy: off[1], close: isFurn })
  })
  // registration flash
  const rf = pr(t, 26.95, 0.5)
  if (rf > 0 && rf < 1) { c.globalAlpha = (1 - rf) * 0.5; c.strokeStyle = lime; c.lineWidth = 12 * (1 - rf) + 2; rrect(-12 - 30 * eo(rf), -12 - 30 * eo(rf), P.w + 24 + 60 * eo(rf), P.h + 24 + 60 * eo(rf), 10); c.stroke(); c.globalAlpha = 1 }
  // the impossible hallway
  const ha = eo(pr(t, 29.15, 0.7))
  stroke(plan.hallA, ha, coral, 6)
  stroke(plan.hallB, ha, coral, 6)
  const ov = eo(pr(t, 29.61, 0.35))
  if (ov > 0) {
    c.globalAlpha = 0.38 * ov; c.fillStyle = coral
    c.fillRect(150, 150, 80, 80)   // corridor swallows the bathroom wall
    c.fillRect(470, 150, 20, 80)   // ...and walks through the divider
    c.globalAlpha = 1
  }
  icon('x', P.w / 2 - 20, 30, 120, pr(t, 30.0, 0.35), coral, 2.4)
  c.restore()
  rise('CLOSEST', P.x, P.y - 34, 30, 'MonoB', lime, t, 26.46, { ls: 0.14 })
  rise('REPLICATION', P.x + measure('CLOSEST ', 'MonoB', 30, 0.14), P.y - 34, 30, 'MonoB', white, t, 26.96, { ls: 0.14 })
  // stamp
  const sp = pr(t, 30.01, 0.3)
  if (sp > 0) {
    const k = mix(1.7, 1, eo(sp)), sh = sp < 1 ? 0 : Math.sin(pr(t, 30.3, 0.2) * Math.PI * 3) * 4 * (1 - pr(t, 30.3, 0.2))
    c.save(); c.translate(W / 2 + sh, 1250); c.rotate(-0.1); c.scale(k, k); c.globalAlpha = Math.min(1, sp * 3)
    rrect(-330, -76, 660, 120, 14); c.strokeStyle = coral; c.lineWidth = 8; c.stroke()
    text('IMPOSSIBLE', 0, 20, 'BrikX', 100, coral, { align: 'center', ls: -0.02 })
    c.restore()
  }
}

// ===================================================================================
// S9  31.6 - 35.15   bone.  A calendar; the camera pushes into the 30th (a real match-zoom).
// ===================================================================================
export function s9(t, lt) {
  const c = S.c
  bg(bone)
  const cardX = 96, cardY = 380, cardW = 888, cardH = 900
  const ent = eo(pr(t, 31.75, 0.7))
  const gx0 = 136, gy0 = 590, cw = 115, ch = 108
  const cell = [gx0 + 1 * cw + cw / 2, gy0 + 4 * ch + ch / 2]
  const z = eo(pr(t, 34.05, 0.7))
  const k = mix(1, 4.3, z)
  c.save()
  c.beginPath(); c.rect(0, 0, W, 1430); c.clip()
  c.translate(mix(0, 540, z), mix(0, 880, z))
  c.scale(k, k)
  c.translate(mix(0, -cell[0], z), mix(0, -cell[1], z))
  c.translate(0, (1 - ent) * 260)
  c.globalAlpha = Math.min(1, ent * 2)
  const ca = clamp(1 - z * 2.2), ga = c.globalAlpha
  if (ca > 0.01) {
  c.globalAlpha = ga * ca
  rrect(cardX + 8, cardY + 18, cardW, cardH, 34); c.fillStyle = 'rgba(11,11,14,0.14)'; c.fill()
  rrect(cardX, cardY, cardW, cardH, 34); c.fillStyle = '#faf8f1'; c.fill()
  c.save(); rrect(cardX, cardY, cardW, 140, 34); c.clip(); c.fillStyle = coral; c.fillRect(cardX, cardY, cardW, 140); c.restore()
  c.fillStyle = coral; c.fillRect(cardX, cardY + 100, cardW, 40)
  text('NOVEMBER', cardX + 44, cardY + 88, 'BrikX', 64, bone, { ls: -0.02 })
  for (const rx of [cardX + 190, cardX + cardW - 190]) { rrect(rx - 10, cardY - 22, 20, 60, 10); c.fillStyle = ink; c.fill() }
  c.globalAlpha = ga
  }
  const fade = 1 - 0.85 * z
  for (let d = 1; d <= 30; d++) {
    const i = d - 1, col = i % 7, row = Math.floor(i / 7)
    const x = gx0 + col * cw + cw / 2, y = gy0 + row * ch + ch / 2 + 14
    c.globalAlpha = (d === 30 ? 1 : fade) * Math.min(1, ent * 2)
    text(String(d), x, y, 'MonoB', 38, d === 30 ? ink : 'rgba(11,11,14,0.5)', { align: 'center' })
  }
  c.globalAlpha = 1
  // hand-drawn ring around the 30th
  const rp = eo(pr(t, 33.42, 0.4))
  if (rp > 0) {
    c.save(); c.translate(cell[0], cell[1] + 14 - 12); c.rotate(-0.25)
    const sweep = Math.PI * 2 * rp * 1.04
    c.beginPath(); c.ellipse(0, 0, 50, 42, 0, -2.2, -2.2 + sweep); c.strokeStyle = coral; c.lineWidth = 7; c.lineCap = 'round'; c.stroke()
    c.restore()
  }
  c.restore()
  // sticker slaps on "expires"
  const sp = eb(pr(t, 32.83, 0.4), 2.4)
  if (sp > 0 && z < 0.2) {
    c.save(); c.translate(W - 250, 330); c.rotate(-0.14); c.scale(sp, sp); c.globalAlpha = 1 - z * 5
    rrect(-190, -52, 380, 100, 18); c.fillStyle = lime; c.fill()
    text('DISCOUNT ENDS', 0, 14, 'MonoB', 34, ink, { align: 'center', ls: 0.06 })
    c.restore()
  }
  rise('NOVEMBER 30TH', L, 360, 34, 'MonoB', ink, t, 34.5, { ls: 0.14 })
}

// ===================================================================================
// S10  35.15 - 41.0   ink.  The hook's bars come back: the price doubles, still half of Fable.
// ===================================================================================
export function s10(t, lt, X) {
  const c = S.c
  bg(ink)
  backVideo(X.vid(10), 1 + 0.1 * eo3(pr(lt, 0, 5.8)), 0.3)
  const bx = L, bw = CW
  rise('AFTER', L, 360, 34, 'MonoB', lime, t, 35.31, { ls: 0.14 })
  rise('NOV 30', L + measure('AFTER ', 'MonoB', 34, 0.14), 360, 34, 'MonoB', white, t, 35.5, { ls: 0.14 })
  const e = eo(pr(t, 35.2, 0.6))
  rise('FABLE 5.2', bx, 690, 32, 'MonoB', coral, t, 35.25, { ls: 0.1 })
  barRow(bx, 712, bw, 118, e, coral, true)
  rise('GEMINI 4 CARBON', bx, 950, 32, 'MonoB', lime, t, 35.45, { ls: 0.1 })
  // price doubles on "doubles": 25% -> 50% with overshoot
  const dp = eb(pr(t, 36.31, 0.6), 1.5)
  const frac = mix(0.25, 0.5, dp)
  barRow(bx, 972, bw, 118, e * frac, lime, false)
  c.fillStyle = 'rgba(11,11,14,0.28)'
  if (dp > 0.02) c.fillRect(bx + bw * 0.25, 972, 4, 118)
  const xb = pr(t, 36.31, 0.4)
  if (xb > 0) { const kk = eb(xb, 2.4); c.save(); c.translate(bx + bw * frac - 80, 1031); c.scale(kk, kk); text('×2', 0, 20, 'BrikX', 64, ink, { align: 'center', ls: -0.03 }); c.restore() }
  // half-of-Fable guide through both bars
  const gp = eo(pr(t, 37.4, 0.45))
  if (gp > 0) {
    c.save(); c.setLineDash([10, 10]); c.strokeStyle = white; c.lineWidth = 3; c.globalAlpha = 0.85
    c.beginPath(); c.moveTo(bx + bw * 0.5, 1110); c.lineTo(bx + bw * 0.5, 1110 - (1110 - 700) * gp); c.stroke(); c.restore()
  }
  const hs = 300
  rise('½', L - 10, 1440, hs, 'BrikX', lime, t, 37.69, { ls: -0.04, dur: 0.6 })
  rise('instead of', L + 330, 1360, 56, 'SerifI', dim, t, 39.33, { dur: 0.5 })
  rise('¼', L + 620, 1440, hs * 0.66, 'BrikX', dim, t, 39.89, { ls: -0.04, dur: 0.5 })
  const sp = eo(pr(t, 40.1, 0.3))
  if (sp > 0) { c.save(); c.strokeStyle = coral; c.lineWidth = 10; c.lineCap = 'round'; c.beginPath(); c.moveTo(L + 600, 1440 - 10); c.lineTo(L + 600 + 210 * sp, 1440 - 190 * sp); c.stroke(); c.restore() }
}

// ===================================================================================
// S11  41.0 - 45.98   desk b-roll, dim; call to action; the discount drains like a timer
// ===================================================================================
export function s11(t, lt, X) {
  const c = S.c
  bg(ink)
  const push = 1 + 0.1 * eo3(pr(lt, 0, 5))
  const vc = X.vid(11)
  if (vc) video(vc, push)
  c.fillStyle = 'rgba(11,11,14,0.7)'; c.fillRect(0, 0, W, H)
  const ts = fit('TEST IT', 'BrikX', CW, 230, 80, -0.04)
  const w = rise('TEST', L, 600, ts, 'BrikX', white, t, 41.23, { ls: -0.04, dur: 0.55 })
  rise('IT', L + w + measure(' ', 'BrikX', ts, -0.04), 600, ts, 'BrikX', lime, t, 41.59, { ls: -0.04, dur: 0.55 })
  rise('before', L, 720, 96, 'SerifI', white, t, 41.7, { dur: 0.5 })
  rise('NOVEMBER', L, 880, fit('NOVEMBER', 'BrikX', CW, 150, 60, -0.04), 'BrikX', white, t, 42.02, { ls: -0.04, dur: 0.6 })
  const ds = fit('30TH', 'BrikX', CW, 400, 100, -0.05)
  rise('30TH', L - 8, 880 + ds * 0.86, ds, 'BrikX', lime, t, 42.12, { ls: -0.05, dur: 0.7 })
  const ty = 880 + ds * 0.86 + 90
  rise('WHILE', L, ty, 32, 'MonoB', white, t, 43.21, { ls: 0.14, dur: 0.4 })
  rise('THE', L + 140, ty, 32, 'MonoB', white, t, 43.39, { ls: 0.14, dur: 0.4 })
  rise('DISCOUNT', L + 240, ty, 32, 'MonoB', white, t, 43.51, { ls: 0.14, dur: 0.4 })
  rise('LASTS', L + 480, ty, 32, 'MonoB', lime, t, 44.01, { ls: 0.14, dur: 0.4 })
  // drain bar: the discount running out
  const full = eo(pr(t, 43.2, 0.4))
  const left = 1 - eio(pr(t, 44.1, 1.8))
  rrect(L, ty + 26, CW * full, 16, 8); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fill()
  if (left > 0) { rrect(L, ty + 26, CW * full * left, 16, 8); c.fillStyle = lime; c.fill() }
  const tp = eo(pr(t, 44.0, 0.6))
  if (tp > 0) {
    c.save(); c.translate(W - 151 - 150, 700 + (1 - tp) * 60); c.rotate(0.05); c.globalAlpha = tp
    rrect(-150, -85, 300, 169, 16); c.clip(); c.drawImage(X.img, -150, -85, 300, 169); c.restore()
    rise('SOURCE', W - 151 - 300, 830, 22, 'MonoM', dim, t, 44.2, { ls: 0.12 })
  }
  // end card
  const cp = eb(pr(t, 44.55, 0.5), 1.6)
  if (cp > 0) {
    c.save(); c.translate(L + 190, 1500); c.scale(cp, cp)
    rrect(-190, -46, 380 + 70, 92, 46); c.fillStyle = lime; c.fill()
    text('Follow for daily dev reels', 35, 12, 'BrikX', 34, ink, { align: 'center', ls: -0.01 })
    c.restore()
    rise('SOURCE · YOUTUBE.COM', L, 1580, 24, 'MonoM', dim, t, 44.8, { ls: 0.12 })
  }
}

export const SCENES = [
  { id: 1, t0: 0, t1: 5.55, fn: s1, cap: false },
  { id: 2, t0: 5.55, t1: 8.6, fn: s2, cap: false, vid: { clip: 11, grade: 'lime' } },
  { id: 3, t0: 8.6, t1: 13.7, fn: s3, cap: true, bone: true },
  { id: 4, t0: 13.7, t1: 17.7, fn: s4, cap: true, vid: { clip: 8, grade: 'lime' } },
  { id: 5, t0: 17.7, t1: 20.0, fn: s5, cap: true, bone: true },
  { id: 6, t0: 20.0, t1: 23.0, fn: s6, cap: true, vid: { clip: 5, grade: 'lime' } },
  { id: 7, t0: 23.0, t1: 25.45, fn: s7, cap: false, vid: { clip: 3, grade: 'warm' } },
  { id: 8, t0: 25.45, t1: 31.6, fn: s8, cap: true },
  { id: 9, t0: 31.6, t1: 35.15, fn: s9, cap: true, bone: true },
  { id: 10, t0: 35.15, t1: 41.0, fn: s10, cap: true, exit: 'up', vid: { clip: 9, grade: 'dim' } },
  { id: 11, t0: 41.0, t1: 45.98, fn: s11, cap: false, vid: { clip: 15, grade: 'dim' } },
]
