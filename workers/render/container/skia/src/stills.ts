import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { FPS } from './engine/kit'
import type { Reel } from './plan'
import { Renderer } from './render'

const TILE_W = 270
const TILE_H = 480
const LABEL_H = 34
const SHEET_COLS = 6
const JPEG_QUALITIES = [82, 65, 45, 30]
export const MAX_SHEET_BYTES = 4_500_000
const MAX_SHEET_TILES = 60

/** Draws the frame at `abs` with a fresh renderer (so the shot's decoders start in the right place) and hands it to `use`. */
export async function withStill<T>(
  reel: Reel,
  assets: string,
  abs: number,
  use: (frame: Canvas) => Promise<T> | T,
): Promise<T> {
  const r = new Renderer(reel, assets)
  try {
    await r.init()
    const shot = reel.shots.find((s) => abs >= s.t0 && abs < s.t1) ?? reel.shots.at(-1)!
    const skip = Math.max(0, abs - shot.t0)
    await r.ensure(shot, skip)
    return await use(await r.frame(abs, Math.floor(skip * FPS + 1e-6)))
  } finally {
    r.close()
  }
}

/** A grid of labelled 270x480 tiles on a dark ground. */
export class Sheet {
  readonly canvas: Canvas
  private g
  private cols: number

  constructor(count: number) {
    const cols = Math.min(SHEET_COLS, Math.max(1, count))
    this.cols = cols
    const rows = Math.ceil(count / cols)
    this.canvas = createCanvas(cols * TILE_W, rows * (TILE_H + LABEL_H))
    this.g = this.canvas.getContext('2d')
    this.g.fillStyle = '#2a2a2a'
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  add(i: number, frame: Canvas, label: string): void {
    const x = (i % this.cols) * TILE_W
    const y = Math.floor(i / this.cols) * (TILE_H + LABEL_H)
    this.g.drawImage(frame, x, y, TILE_W, TILE_H)
    this.g.fillStyle = '#fff'
    this.g.font = '20px Geist'
    this.g.fillText(label, x + 8, y + TILE_H + 24)
  }
}

/** Two frames per scene (early and late), the model's review contact sheet. */
export function reviewTimes(reel: Reel): number[] {
  return reel.shots
    .flatMap((s) => [s.t0 + Math.min(0.5, s.dur * 0.25), s.t0 + s.dur * 0.75])
    .slice(0, MAX_SHEET_TILES)
}

/** Encodes a sheet as JPEG, lowering quality until it fits the API image budget. */
export async function encodeJpeg(sheet: Canvas, maxBytes = MAX_SHEET_BYTES): Promise<Buffer> {
  let out = await sheet.encode('jpeg', JPEG_QUALITIES[0])
  for (const q of JPEG_QUALITIES.slice(1)) {
    if (out.length <= maxBytes) break
    out = await sheet.encode('jpeg', q)
  }
  return out
}

export async function reviewSheetJpeg(
  reel: Reel,
  assets: string,
  onTile?: (done: number, total: number) => void,
): Promise<Buffer> {
  const times = reviewTimes(reel)
  const sheet = new Sheet(times.length)
  for (const [i, abs] of times.entries()) {
    await withStill(reel, assets, abs, (frame) => {
      const shot = reel.shots.find((s) => abs >= s.t0 && abs < s.t1) ?? reel.shots.at(-1)!
      sheet.add(i, frame, `scene ${shot.index} t=${abs.toFixed(2)}s`)
    })
    onTile?.(i + 1, times.length)
  }
  return encodeJpeg(sheet.canvas)
}
