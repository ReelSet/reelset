// node bench.mjs <jobDir> <frames> <concurrency> <jpegQuality> <x264Preset>: times a frame range of a staged job
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMedia, selectComposition } from '@remotion/renderer'

const root = path.dirname(fileURLToPath(import.meta.url))
const serveUrl = path.join(root, 'build')
const [jobDir, frames = '240', concurrency = '4', jpegQuality = '92', preset = 'veryfast'] =
  process.argv.slice(2)
const props = JSON.parse(fs.readFileSync(path.join(jobDir, 'props.json'), 'utf8'))
const stage = path.join(serveUrl, 'public', 'job')
fs.rmSync(stage, { recursive: true, force: true })
fs.cpSync(path.join(jobDir, 'assets'), stage, { recursive: true })
const out = path.join(os.tmpdir(), `bench-${process.pid}.mp4`)
try {
  const composition = await selectComposition({ serveUrl, id: 'Reel', inputProps: props, logLevel: 'error' })
  const start = Date.now()
  const from = Math.min(300, Math.max(0, composition.durationInFrames - Number(frames) - 1))
  await renderMedia({
    composition,
    serveUrl,
    inputProps: props,
    codec: 'h264',
    outputLocation: out,
    frameRange: [from, from + Number(frames) - 1],
    concurrency: Number(concurrency),
    videoBitrate: '3000k',
    x264Preset: preset,
    pixelFormat: 'yuv420p',
    imageFormat: 'jpeg',
    jpegQuality: Number(jpegQuality),
    logLevel: 'error',
    timeoutInMilliseconds: 90_000,
  })
  const ms = Date.now() - start
  const bytes = fs.statSync(out).size
  console.log(
    JSON.stringify({ concurrency: Number(concurrency), jpegQuality: Number(jpegQuality), preset, frames: Number(frames), ms, fps: +(Number(frames) / (ms / 1000)).toFixed(2), kbPerFrame: +(bytes / 1024 / Number(frames)).toFixed(1) }),
  )
} finally {
  fs.rmSync(out, { force: true })
  fs.rmSync(stage, { recursive: true, force: true })
}
