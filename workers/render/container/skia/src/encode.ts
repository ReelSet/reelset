import { spawn } from 'node:child_process'
import path from 'node:path'
import { FPS, H, W } from './engine/kit'
import { log } from './engine/log'
import type { Reel } from './plan'
import { Renderer, assetPath } from './render'

const GC_EVERY_FRAMES = 48

function ffmpegArgs(audio: string, duration: number, outFile: string): string[] {
  return [
    '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-i', audio,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', process.env.X264_PRESET ?? 'veryfast', '-crf', '22',
    '-maxrate', '3500k', '-bufsize', '7000k',
    '-x264-params', 'threads=2:lookahead-threads=1:sync-lookahead=0:rc-lookahead=10:ref=2:bframes=2',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-t', duration.toFixed(3), '-movflags', '+faststart', outFile,
  ] // prettier-ignore
}

/** Draws every frame and pipes it to ffmpeg with the narration. Prints `tick` per frame (a heartbeat) and `render progress` per 10%. */
export async function encodeReel(reel: Reel, assets: string, outFile: string): Promise<void> {
  const audio = path.join(assets, assetPath(reel.props.audio))
  const total = Math.ceil(reel.duration * FPS)
  const ff = spawn('ffmpeg', ffmpegArgs(audio, reel.duration, outFile), {
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  const done = new Promise<void>((res, rej) =>
    ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)))),
  )
  const renderer = new Renderer(reel, assets)
  await renderer.init()
  const started = Date.now()
  let lastPct = -1
  try {
    for (let f = 0; f < total; f++) {
      const cv = await renderer.frame(f / FPS)
      if (!ff.stdin.write(cv.data())) await new Promise((res) => ff.stdin.once('drain', res))
      const pct = Math.floor((f / total) * 10) * 10
      if (pct !== lastPct) {
        lastPct = pct
        console.log(`render progress ${pct}% t=${Math.round((Date.now() - started) / 1000)}s`)
      }
      console.log(`tick ${f}`)
      if (f % GC_EVERY_FRAMES === 0 && typeof globalThis.gc === 'function') globalThis.gc()
    }
    ff.stdin.end()
    await done
  } finally {
    renderer.close()
  }
  log.info({ frames: total, ms: Date.now() - started }, 'encoded')
  console.log(
    `render done frames=${total} ms=${Date.now() - started} rssMB=${Math.round(process.memoryUsage().rss / 1e6)}`,
  )
}
