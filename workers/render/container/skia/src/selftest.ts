import { createCanvas } from '@napi-rs/canvas'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSceneReel } from './director/load'
import { encodeReel } from './encode'
import { registerFonts } from './engine/draw'
import { log } from './engine/log'
import { buildReel, type ReelProps } from './plan'
import { withStill } from './stills'

const SECONDS = 2
const MIN_VIDEO_BYTES = 2000
const SCRIPT = `const bg = COL.ink
return [{ t0: 0, fn: (t) => { S.c.fillStyle = bg; S.c.fillRect(0, 0, W, H); text('selftest', 96, 600, 'BrikX', 120, COL.lime) }, cap: false }]`

function fixtureProps(): ReelProps {
  const words = ['One', 'quick', 'fixture', 'for', 'the', 'renderer', 'self', 'test'].map(
    (text, i) => ({ text, start: i * 0.25, end: i * 0.25 + 0.2 }),
  )
  return {
    durationSeconds: SECONDS,
    title: 'Renderer self test',
    source: 'github',
    sourceLabel: 'GitHub',
    domain: 'github.com',
    scenes: [
      { kind: 'hook', start: 0, end: 1, text: 'One quick fixture for the' },
      { kind: 'outro', start: 1, end: SECONDS, text: 'renderer self test' },
    ],
    words,
    audio: 'job/narration.wav',
    images: [{ src: 'job/cover.png', kind: 'og', width: 400, height: 300 }],
  }
}

function writeFixture(dir: string): void {
  const assets = path.join(dir, 'assets')
  mkdirSync(assets, { recursive: true })
  const cv = createCanvas(400, 300)
  const g = cv.getContext('2d')
  g.fillStyle = '#c8f751'
  g.fillRect(0, 0, 400, 300)
  writeFileSync(path.join(assets, 'cover.png'), cv.toBuffer('image/png'))
  const wav = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(SECONDS), path.join(assets, 'narration.wav')],
    { encoding: 'utf8' },
  ) // prettier-ignore
  if (wav.status !== 0) throw new Error(`ffmpeg could not make the fixture audio: ${wav.stderr}`)
}

/** Renders a 2 s fixture reel, then one scripted frame through the sandbox, with no network. Throws on failure. */
export async function runSelftest(): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reelset-selftest-'))
  try {
    writeFixture(dir)
    registerFonts()
    const base = buildReel(fixtureProps())
    const assets = path.join(dir, 'assets')
    const out = path.join(dir, 'raw.mp4')
    await encodeReel(base, assets, out)
    const bytes = statSync(out).size
    if (bytes < MIN_VIDEO_BYTES) throw new Error(`selftest video is only ${bytes} bytes`)
    const scripted = loadSceneReel(base, SCRIPT)
    const png = await withStill(scripted.reel, assets, 0.5, (f) => f.encode('png'))
    if (scripted.errors().length > 0 || png.length < 1000)
      throw new Error('selftest scripted frame failed')
    log.info({ videoBytes: bytes, shots: base.shots.length }, 'selftest ok')
    console.log('selftest ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
