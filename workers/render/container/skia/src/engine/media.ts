import { createCanvas, ImageData, loadImage, type Canvas, type Image } from '@napi-rs/canvas'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { FPS } from './kit'
import { log } from './log'

/** Decoded still. Big sources are downscaled once so per-frame drawing stays cheap. */
export type Still = Canvas | Image

const MAX_SIDE = 1600

export async function loadStill(file: string): Promise<Still | null> {
  if (!existsSync(file)) return null
  try {
    const img = await loadImage(file)
    const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
    if (k >= 1) return img
    const cv = createCanvas(Math.round(img.width * k), Math.round(img.height * k))
    const g = cv.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, cv.width, cv.height)
    return cv
  } catch (err) {
    log.warn({ file: path.basename(file), err: (err as Error).message }, 'image decode failed')
    return null
  }
}

/** A video stretch decoded by ffmpeg into raw RGBA at FPS, read frame by frame. */
export type VideoSpec = {
  /** Path relative to the job's assets folder. */
  src: string
  /** Seconds into the file to start. */
  at: number
  /** Frames needed (the reader loops the file if it is shorter). */
  frames: number
  w: number
  h: number
  /** 'cover' crops to w x h; 'fit' keeps the whole frame (letterboxed inside w x h). */
  mode: 'cover' | 'fit'
  /** Extra ffmpeg filters (grading) applied before scaling. */
  grade?: string
}

export class VideoReader {
  private chunks: Buffer[] = []
  private total = 0
  private ended = false
  private wake: (() => void) | null = null
  private next = 0
  private proc: ChildProcessByStdio<null, Readable, null>
  private readonly bytes: number
  readonly canvas: Canvas
  private hasFrame = false

  constructor(
    assetsDir: string,
    readonly spec: VideoSpec,
  ) {
    const { w, h } = spec
    this.bytes = w * h * 4
    this.canvas = createCanvas(w, h)
    const scale =
      spec.mode === 'cover'
        ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
        : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`
    const vf = [`fps=${FPS}`, spec.grade, scale, 'format=rgba'].filter(Boolean).join(',')
    const args = ['-v', 'error', '-threads', '1', '-stream_loop', '-1']
    if (spec.at > 0) args.push('-ss', spec.at.toFixed(3))
    args.push(
      '-i',
      path.join(assetsDir, spec.src),
      '-an',
      '-frames:v',
      String(spec.frames + 2),
      '-vf',
      vf,
      '-f',
      'rawvideo',
      '-',
    )
    this.proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] })
    const out = this.proc.stdout
    out.on('data', (d: Buffer) => {
      this.chunks.push(d)
      this.total += d.length
      if (this.total >= 3 * this.bytes) out.pause()
      this.wake?.()
    })
    out.on('end', () => {
      this.ended = true
      this.wake?.()
    })
    this.proc.on('error', (err) => {
      log.warn({ src: spec.src, err: err.message }, 'video decoder failed to start')
      this.ended = true
      this.wake?.()
    })
  }

  private take(): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks)
    const frame = all.subarray(0, this.bytes)
    const rest = all.subarray(this.bytes)
    this.chunks = rest.length ? [rest] : []
    this.total = rest.length
    if (this.total < 3 * this.bytes) this.proc.stdout.resume()
    return frame
  }

  /** Advances to frame `i` (never backwards) and returns the canvas, or null before the first frame. */
  async frame(i: number): Promise<Canvas | null> {
    while (this.next <= i) {
      while (this.total < this.bytes && !this.ended)
        await new Promise<void>((r) => {
          this.wake = () => {
            this.wake = null
            r()
          }
        })
      if (this.total < this.bytes) break
      const buf = this.take()
      this.next += 1
      if (this.next > i) {
        const data = new Uint8ClampedArray(buf.buffer, buf.byteOffset, this.bytes)
        this.canvas
          .getContext('2d')
          .putImageData(new ImageData(data, this.spec.w, this.spec.h), 0, 0)
        this.hasFrame = true
      }
    }
    return this.hasFrame ? this.canvas : null
  }

  close(): void {
    this.proc.stdout.destroy()
    this.proc.kill('SIGKILL')
  }
}

/** ffmpeg grades used for stock backdrops (done in the decoder, off the drawing thread). */
export const GRADE = {
  backdrop: 'eq=saturation=0.75:contrast=1.06:brightness=-0.06',
  mono: 'format=gray,eq=contrast=1.25:brightness=0.02,format=rgb24,colorchannelmixer=rr=0.8:gg=0.98:bb=0.3',
  warm: 'eq=contrast=1.12:saturation=0.85:brightness=-0.03',
  none: '',
} as const
