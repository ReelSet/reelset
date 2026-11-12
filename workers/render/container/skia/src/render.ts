import { createCanvas, type Canvas } from '@napi-rs/canvas'
import path from 'node:path'
import { Finish, Captions, Header, Headline } from './chrome/overlay'
import type { Ctx } from './engine/draw'
import { COL, FPS, H, W, clamp, ei4, eo4, type Tone } from './engine/kit'
import { log } from './engine/log'
import { GRADE, VideoReader, loadStill, type Still, type VideoSpec } from './engine/media'
import { shotAt, type Reel, type Shot } from './plan'
import { SCREENS, fallback } from './screens'
import type { DrawArgs, Media, Screen } from './screens/types'

/** Props write asset paths as 'job/x.jpg'; on disk they sit in the job's assets/ folder. */
export const assetPath = (src: string) => src.replace(/^job\//, '')

type ShotState = {
  memo: Map<string, unknown>
  files: Map<string, Still | null>
  backdrop: VideoReader | null
  video: VideoReader | null
  failed: boolean
  ready: Promise<void> | null
}

// Seams (cut-the-curve): the outgoing shot accelerates out, the next enters mid-path at matching speed.
const NOUT = 8 / 30
const NIN = 10 / 30
const D = 300
const DS = 325
const DY = 420
const DYS = 450

export class Renderer {
  readonly canvas: Canvas
  private c: Ctx
  private layer: Canvas
  private header: Header
  private captions: Captions
  private headline: Headline
  private finish: Finish
  private images: (Still | null)[] = []
  private states = new Map<number, ShotState>()

  constructor(
    readonly reel: Reel,
    readonly assets: string,
  ) {
    this.canvas = createCanvas(W, H)
    this.c = this.canvas.getContext('2d')
    this.layer = createCanvas(W, H)
    this.header = new Header(reel)
    this.captions = new Captions(reel)
    this.headline = new Headline(reel)
    this.finish = new Finish(this.c)
  }

  async init(): Promise<void> {
    this.images = await Promise.all(
      this.reel.ctx.images.map((im) => loadStill(path.join(this.assets, assetPath(im.src)))),
    )
    log.info(
      { images: this.images.length, decoded: this.images.filter(Boolean).length },
      'images ready',
    )
  }

  screenOf(shot: Shot): Screen {
    return shot.screen ?? SCREENS[shot.show] ?? fallback
  }

  private state(shot: Shot): ShotState {
    let s = this.states.get(shot.index)
    if (!s) {
      s = {
        memo: new Map(),
        files: new Map(),
        backdrop: null,
        video: null,
        failed: false,
        ready: null,
      }
      this.states.set(shot.index, s)
    }
    return s
  }

  /** Decodes files, runs `prepare` and starts the shot's video decoders (once). `skip` seconds into the shot for stills. */
  ensure(shot: Shot, skip = 0): Promise<void> {
    const st = this.state(shot)
    st.ready ??= (async () => {
      const screen = this.screenOf(shot)
      try {
        for (const rel of screen.files?.(shot, this.reel) ?? [])
          st.files.set(rel, await loadStill(path.join(this.assets, assetPath(rel))))
        await screen.prepare?.(shot, this.reel)
      } catch (err) {
        log.warn(
          { shot: shot.index, show: shot.show, err: (err as Error).message },
          'screen prepare failed',
        )
      }
      const frames = Math.ceil(shot.dur * FPS) + 4
      if (shot.clip) {
        const spec: VideoSpec = {
          src: assetPath(shot.clip.src),
          at: (shot.clip.at ?? 0) + skip,
          frames,
          w: 720,
          h: 1280,
          mode: 'cover',
          grade: shot.grade ?? GRADE.backdrop,
        }
        st.backdrop = new VideoReader(this.assets, spec)
      }
      const v = screen.video?.(shot, this.reel)
      if (v)
        st.video = new VideoReader(this.assets, { ...v, at: v.at + skip, src: assetPath(v.src) })
    })()
    return st.ready
  }

  release(shot: Shot): void {
    const st = this.states.get(shot.index)
    if (!st) return
    st.backdrop?.close()
    st.video?.close()
    this.states.delete(shot.index)
  }

  /** Pulls this frame's video frames for the shot. `base` is the frame index the decoders started at. */
  private async videos(
    shot: Shot,
    abs: number,
    base: number,
  ): Promise<{ bd: Canvas | null; vid: Canvas | null }> {
    const st = this.state(shot)
    const i = Math.max(0, Math.floor((abs - shot.t0) * FPS + 1e-6) - base)
    const bd = st.backdrop ? await st.backdrop.frame(i) : null
    const vid = st.video ? await st.video.frame(i) : null
    return { bd, vid }
  }

  private drawShot(
    c: Ctx,
    shot: Shot,
    abs: number,
    frames: { bd: Canvas | null; vid: Canvas | null },
  ): void {
    const st = this.state(shot)
    const media: Media = {
      image: (i) => this.images[i] ?? null,
      file: (rel) => st.files.get(rel) ?? null,
      video: () => frames.vid,
      backdrop: () => frames.bd,
    }
    const args: DrawArgs = {
      c,
      t: Math.max(0, abs - shot.t0),
      abs,
      shot,
      reel: this.reel,
      ctx: this.reel.ctx,
      media,
      memo: <T>(key: string, make: () => T): T => {
        if (!st.memo.has(key)) st.memo.set(key, make())
        return st.memo.get(key) as T
      },
    }
    const screen = st.failed ? fallback : this.screenOf(shot)
    c.save()
    try {
      screen.draw(args)
    } catch (err) {
      c.restore()
      c.save()
      st.failed = true
      log.warn(
        { shot: shot.index, show: shot.show, err: (err as Error).stack?.slice(0, 600) },
        'screen draw failed, using fallback',
      )
      fallback.draw(args)
    }
    c.restore()
  }

  toneOf(shot: Shot): Tone {
    try {
      return this.screenOf(shot).tone?.(shot, this.reel) ?? 'dark'
    } catch {
      return 'dark'
    }
  }

  private seam(shot: Shot, abs: number): { x: number; y: number; vx: number; vy: number } | null {
    const next = this.reel.shots[shot.index + 1]
    const dt = 1 / FPS
    const exitPos = (p: number, up: boolean) =>
      (up ? [0, -DY * ei4(p)] : [-D * ei4(p), 0]) as [number, number]
    const entryPos = (q: number, up: boolean) =>
      (up ? [0, DYS * (1 - eo4(q))] : [DS * (1 - eo4(q)), 0]) as [number, number]
    if (
      next &&
      (next.enter === 'left' || next.enter === 'up') &&
      abs >= shot.t1 - NOUT &&
      shot.dur > NOUT + NIN
    ) {
      const up = next.enter === 'up'
      const p = clamp((abs - (shot.t1 - NOUT) + dt) / NOUT)
      const pp = clamp((abs - (shot.t1 - NOUT)) / NOUT)
      const [x, y] = exitPos(p, up)
      const [x0, y0] = exitPos(pp, up)
      return { x, y, vx: x - x0, vy: y - y0 }
    }
    if ((shot.enter === 'left' || shot.enter === 'up') && abs < shot.t0 + NIN && shot.index > 0) {
      const up = shot.enter === 'up'
      const q = (abs - shot.t0) / NIN
      const q1 = Math.min(1, (abs - shot.t0 + dt) / NIN)
      const [x, y] = entryPos(q, up)
      const [x1, y1] = entryPos(q1, up)
      return { x, y, vx: x1 - x, vy: y1 - y }
    }
    return null
  }

  /** Draws the frame at `abs` seconds. `base` is the decoder start frame of the current shot (stills only). */
  async frame(abs: number, base = 0): Promise<Canvas> {
    const shot = shotAt(this.reel, abs)
    await this.ensure(shot)
    const next = this.reel.shots[shot.index + 1]
    if (next && next.t0 - abs < 1.0) void this.ensure(next)
    const vids = await this.videos(shot, abs, base)
    const c = this.c
    const xf = this.seam(shot, abs)
    if (!xf) this.drawShot(c, shot, abs, vids)
    else {
      const lc = this.layer.getContext('2d')
      lc.clearRect(0, 0, W, H)
      this.drawShot(lc, shot, abs, vids)
      c.fillStyle = COL.ink
      c.fillRect(0, 0, W, H)
      const n = 5
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1) - 0.5
        c.globalAlpha = i === 0 ? 1 : 1 / (i + 1)
        c.drawImage(this.layer, xf.x + xf.vx * 0.8 * k, xf.y + xf.vy * 0.8 * k)
      }
      c.globalAlpha = 1
    }
    const tone = this.toneOf(shot)
    this.finish.draw(c, tone)
    if (shot.topPad > 0 || abs < (this.reel.headline?.t1 ?? 0) + 0.4) this.headline.draw(c, abs)
    const caps = this.screenOf(shot).captions?.(shot, this.reel) ?? true
    if (caps) this.captions.draw(c, abs, tone)
    this.header.draw(c, abs, tone)
    for (const s of this.reel.shots)
      if (s.t1 < abs - 0.05 && this.states.has(s.index)) this.release(s)
    return this.canvas
  }

  close(): void {
    for (const s of this.reel.shots) this.release(s)
  }
}
