// node dist/draw.mjs <jobDir> [--scenes file --report file] [--review-sheet file] [--stills t,..|--show Name|--sheet] [--out dir]
// node dist/draw.mjs --selftest
// Draws <jobDir>/props.json + assets/ to raw.mp4 (narration muxed) and timeline.json. No browser. With --scenes the
// model's script draws the shots; this process holds no secrets (the orchestrator scrubs its environment).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EXIT_LOAD_ERROR, type DrawReport } from './director/config'
import { loadSceneReel } from './director/load'
import { encodeReel } from './encode'
import { registerFonts } from './engine/draw'
import { log } from './engine/log'
import { buildReel, timelineOf, type Reel, type ReelProps } from './plan'
import { runSelftest } from './selftest'
import { Sheet, reviewSheetJpeg, withStill } from './stills'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? '') : null
}

async function debugStills(reel: Reel, assets: string, out: string): Promise<void> {
  const stills = flag('stills')
  const show = flag('show')
  const sheet = args.includes('--sheet')
  let times: number[] = []
  if (stills) times = stills.split(',').map(Number)
  if (show)
    for (const s of reel.shots.filter((x) => x.show === show))
      times.push(s.t0 + 0.08, s.t0 + Math.min(0.7, s.dur / 2), s.t0 + s.dur * 0.6, s.t1 - 0.06)
  if (sheet) times = reel.shots.map((s) => s.t0 + Math.min(1.2, s.dur * 0.6))
  mkdirSync(out, { recursive: true })
  const grid = new Sheet(times.length)
  for (const [i, t] of times.entries()) {
    await withStill(reel, assets, t, async (frame) => {
      writeFileSync(
        path.join(out, `t${t.toFixed(2).padStart(6, '0')}.png`),
        await frame.encode('png'),
      )
      const s = reel.shots[i]
      grid.add(i, frame, s ? `${i} ${s.show} ${s.t0.toFixed(1)}s` : `t=${t.toFixed(2)}s`)
    })
  }
  if (sheet) writeFileSync(path.join(out, 'sheet.png'), await grid.canvas.encode('png'))
  console.log(JSON.stringify({ stills: times.length, out }))
}

async function main(): Promise<void> {
  if (args.includes('--selftest')) return runSelftest()
  const jobDir = args[0]
  if (!jobDir || jobDir.startsWith('--'))
    throw new Error(
      'usage: node draw.mjs <jobDir> [--scenes f --report f] [--stills ..|--sheet] [--out dir]',
    )
  const jobId = path.basename(jobDir)
  const assets = path.join(jobDir, 'assets')
  const reportFile = flag('report')
  const writeReport = (r: DrawReport) => reportFile && writeFileSync(reportFile, JSON.stringify(r))

  registerFonts()
  const props = JSON.parse(readFileSync(path.join(jobDir, 'props.json'), 'utf8')) as ReelProps
  const base = buildReel(props)
  for (const w of base.warnings) log.warn({ jobId, warning: w }, 'plan')

  let reel = base
  let drawn: ReturnType<typeof loadSceneReel> | null = null
  const scriptFile = flag('scenes')
  if (scriptFile) {
    try {
      drawn = loadSceneReel(base, readFileSync(scriptFile, 'utf8'))
      reel = drawn.reel
    } catch (err) {
      const loadError = (err as Error).message.slice(0, 400)
      log.warn({ jobId, loadError }, 'script failed to load')
      writeReport({ loadError, scenes: 0, sceneErrors: [] })
      process.exit(EXIT_LOAD_ERROR)
    }
  }
  const report = (): DrawReport => ({
    loadError: null,
    scenes: reel.shots.length,
    sceneErrors: drawn?.errors() ?? [],
  })

  const reviewFile = flag('review-sheet')
  if (reviewFile) {
    const jpeg = await reviewSheetJpeg(reel, assets, (n, total) =>
      console.log(`review still ${n}/${total}`),
    )
    writeFileSync(reviewFile, jpeg)
    writeReport(report())
    log.info({ jobId, bytes: jpeg.length, scenes: reel.shots.length }, 'review sheet written')
    return
  }
  if (flag('stills') !== null || flag('show') !== null || args.includes('--sheet')) {
    await debugStills(reel, assets, flag('out') ?? path.join(jobDir, 'stills'))
    return
  }

  writeFileSync(path.join(jobDir, 'timeline.json'), JSON.stringify(timelineOf(reel)))
  console.log(
    `plan shots=${reel.shots.length} avg=${(reel.duration / Math.max(1, reel.shots.length)).toFixed(2)}s frames=${Math.ceil(reel.duration * 24)}`,
  )
  await encodeReel(reel, assets, path.join(jobDir, 'raw.mp4'))
  writeReport(report())
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error({ err: (err as Error).stack?.slice(0, 800) }, 'draw failed')
    process.exit(1)
  },
)
