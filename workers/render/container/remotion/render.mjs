// node render.mjs <jobDir>: renders <jobDir>/props.json (+ <jobDir>/assets/*) to <jobDir>/raw.mp4
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMedia, selectComposition } from '@remotion/renderer'

const root = path.dirname(fileURLToPath(import.meta.url))
const serveUrl = process.env.REEL_BUNDLE_DIR ?? path.join(root, 'build')
const jobDir = process.argv[2]
if (!jobDir) throw new Error('usage: node render.mjs <jobDir>')

const props = JSON.parse(fs.readFileSync(path.join(jobDir, 'props.json'), 'utf8'))
const stage = path.join(serveUrl, 'public', 'job')
fs.rmSync(stage, { recursive: true, force: true })
fs.cpSync(path.join(jobDir, 'assets'), stage, { recursive: true })

const concurrency =
  Number(process.env.REEL_CONCURRENCY) || Math.max(1, Math.min(2, os.availableParallelism()))
const started = Date.now()
let lastLogged = -1
try {
  const composition = await selectComposition({
    serveUrl,
    id: 'Reel',
    inputProps: props,
    logLevel: 'warn',
  })
  const fps = composition.fps
  const plan = composition.props.plan ?? []
  fs.writeFileSync(
    path.join(jobDir, 'timeline.json'),
    JSON.stringify({
      fps,
      durationInFrames: composition.durationInFrames,
      usedBroll: [...new Set(plan.map((s) => s.props?.bg).filter((n) => Number.isInteger(n)))],
      usedDemo: plan.some((s) => s.show === 'RepoDemo'),
      shots: plan.map((s) => ({
        t: Math.round((s.from / fps) * 1000) / 1000,
        seconds: Math.round((s.frames / fps) * 1000) / 1000,
        show: s.show,
        sfx: s.sfx,
        origin: s.origin,
        scene: s.sceneIndex,
      })),
    }),
  )
  console.log(
    `plan shots=${plan.length} avg=${(composition.durationInFrames / fps / Math.max(1, plan.length)).toFixed(2)}s`,
  )
  await renderMedia({
    composition,
    serveUrl,
    inputProps: props,
    codec: 'h264',
    outputLocation: path.join(jobDir, 'raw.mp4'),
    concurrency,
    videoBitrate: '2800k',
    audioBitrate: '96k',
    x264Preset: 'veryfast',
    pixelFormat: 'yuv420p',
    imageFormat: 'jpeg',
    jpegQuality: 92,
    logLevel: 'warn',
    timeoutInMilliseconds: 90_000,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10
      if (pct !== lastLogged) {
        lastLogged = pct
        console.log(`render progress ${pct}% t=${Math.round((Date.now() - started) / 1000)}s`)
      }
    },
  })
  console.log(`render done frames=${composition.durationInFrames} ms=${Date.now() - started}`)
} finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
