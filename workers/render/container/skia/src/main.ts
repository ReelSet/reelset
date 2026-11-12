// node dist/render.mjs <jobDir> [--stills t1,t2 | --show Name | --sheet] [--out dir]
// Renders <jobDir>/props.json + assets/ to <jobDir>/raw.mp4 (narration muxed) and writes timeline.json. No browser.
import { createCanvas } from '@napi-rs/canvas'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { registerFonts } from './engine/draw'
import { FPS, H, W } from './engine/kit'
import { log } from './engine/log'
import { buildReel, timelineOf, type ReelProps } from './plan'
import { Renderer, assetPath } from './render'

const args = process.argv.slice(2)
const jobDir = args[0]
if (!jobDir)
  throw new Error('usage: node render.mjs <jobDir> [--stills t,..|--show Name|--sheet] [--out dir]')
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? '') : null
}

registerFonts()
const props = JSON.parse(readFileSync(path.join(jobDir, 'props.json'), 'utf8')) as ReelProps
const reel = buildReel(props)
for (const w of reel.warnings) log.warn({ warning: w }, 'plan')
writeFileSync(path.join(jobDir, 'timeline.json'), JSON.stringify(timelineOf(reel)))
const assets = path.join(jobDir, 'assets')
const total = Math.ceil(reel.duration * FPS)
console.log(
  `plan shots=${reel.shots.length} avg=${(reel.duration / Math.max(1, reel.shots.length)).toFixed(2)}s frames=${total}`,
)

/** Stills: a fresh renderer per still so each shot's decoders start at the right spot. */
async function still(abs: number) {
  const r = new Renderer(reel, assets)
  await r.init()
  const shot = reel.shots.find((s) => abs >= s.t0 && abs < s.t1) ?? reel.shots.at(-1)!
  const skip = Math.max(0, abs - shot.t0)
  await r.ensure(shot, skip)
  const cv = await r.frame(abs, Math.floor(skip * FPS + 1e-6))
  const png = await cv.encode('png')
  r.close()
  return png
}

const out = flag('out') ?? path.join(jobDir, 'stills')
const stills = flag('stills')
const show = flag('show')
const sheet = args.includes('--sheet')
if (stills !== null || show !== null || sheet) {
  mkdirSync(out, { recursive: true })
  let times: number[] = []
  if (stills) times = stills.split(',').map(Number)
  if (show)
    for (const s of reel.shots.filter((x) => x.show === show))
      times.push(s.t0 + 0.08, s.t0 + Math.min(0.7, s.dur / 2), s.t0 + s.dur * 0.6, s.t1 - 0.06)
  if (sheet) times = reel.shots.map((s) => s.t0 + Math.min(1.2, s.dur * 0.6))
  const files: string[] = []
  for (const t of times) {
    const f = path.join(out, `t${t.toFixed(2).padStart(6, '0')}.png`)
    writeFileSync(f, await still(t))
    files.push(f)
  }
  if (sheet) {
    const { loadImage } = await import('@napi-rs/canvas')
    const cols = 6
    const tw = 270
    const th = 480
    const rows = Math.ceil(files.length / cols)
    const cv = createCanvas(cols * tw, rows * (th + 30))
    const g = cv.getContext('2d')
    g.fillStyle = '#222'
    g.fillRect(0, 0, cv.width, cv.height)
    for (const [i, f] of files.entries()) {
      const img = await loadImage(f)
      const x = (i % cols) * tw
      const y = Math.floor(i / cols) * (th + 30)
      g.drawImage(img, x, y, tw, th)
      g.fillStyle = '#fff'
      g.font = '18px Geist'
      const s = reel.shots[i]!
      g.fillText(`${i} ${s.show} ${s.t0.toFixed(1)}s`, x + 6, y + th + 21)
    }
    writeFileSync(path.join(out, 'sheet.png'), await cv.encode('png'))
  }
  console.log(JSON.stringify({ stills: files.length, out }))
  process.exit(0)
}

const outFile = path.join(jobDir, 'raw.mp4')
const audio = path.join(assets, assetPath(props.audio))
const ff = spawn(
  'ffmpeg',
  [
    '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-i', audio,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', process.env.X264_PRESET ?? 'veryfast', '-crf', '22',
    '-maxrate', '3500k', '-bufsize', '7000k',
    '-x264-params', 'threads=2:lookahead-threads=1:sync-lookahead=0:rc-lookahead=10:ref=2:bframes=2',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-t', reel.duration.toFixed(3), '-movflags', '+faststart', outFile,
  ], // prettier-ignore
  { stdio: ['pipe', 'inherit', 'inherit'] },
)
const done = new Promise<void>((res, rej) =>
  ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)))),
)
const r = new Renderer(reel, assets)
await r.init()
const started = Date.now()
let lastPct = -1
for (let f = 0; f < total; f++) {
  const cv = await r.frame(f / FPS)
  if (!ff.stdin.write(cv.data())) await new Promise((res) => ff.stdin.once('drain', res))
  const pct = Math.floor((f / total) * 10) * 10
  if (pct !== lastPct) {
    lastPct = pct
    console.log(`render progress ${pct}% t=${Math.round((Date.now() - started) / 1000)}s`)
  }
  if (f % 48 === 0 && typeof globalThis.gc === 'function') globalThis.gc()
}
ff.stdin.end()
await done
r.close()
console.log(
  `render done frames=${total} ms=${Date.now() - started} rssMB=${Math.round(process.memoryUsage().rss / 1e6)}`,
)
