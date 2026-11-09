#!/usr/bin/env node
// Usage: node scripts/smoke/aura/aura.mjs --text "..." [--speaker luna | --speakers luna,orion] [--out dir]
// Writes <out>/<speaker>/audio.mp3 + words.json (the container's word-timing shape: text/start/end).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const norm = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
function wer(ref, hyp) {
  const r = norm(ref)
  const h = norm(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1),
      )
  return d[r.length][h.length] / r.length
}

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
)
const text = args.text
const speakers = (args.speakers ?? args.speaker ?? 'luna').split(',')
const out = resolve(args.out ?? join(here, 'out'))
const port = Number(args.port ?? 8799)
if (!text) {
  console.error('usage: aura.mjs --text "..." [--speaker luna | --speakers a,b] [--out dir]')
  process.exit(2)
}

const env = { ...process.env }
delete env.CLOUDFLARE_API_TOKEN
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1'], {
  cwd: here,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
dev.stdout.on('data', (d) => (log += d))
dev.stderr.on('data', (d) => (log += d))
const stop = () => dev.kill('SIGTERM')
process.on('exit', stop)

async function ready() {
  for (let i = 0; i < 120; i++) {
    if (dev.exitCode !== null) throw new Error(`wrangler exited:\n${log.slice(-1500)}`)
    if (/Ready on/.test(log)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`wrangler not ready:\n${log.slice(-1500)}`)
}

try {
  await ready()
  for (const speaker of speakers) {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      body: JSON.stringify({ text, speaker }),
    })
    if (!res.ok)
      throw new Error(
        `${speaker}: ${res.status} ${(await res.text()).slice(0, 500)}\n${log.slice(-1500)}`,
      )
    const body = await res.json()
    const dir = speakers.length > 1 || args.speakers ? join(out, speaker) : out
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'audio.mp3'), Buffer.from(body.audioBase64, 'base64'))
    writeFileSync(join(dir, 'words.json'), JSON.stringify(body.words, null, 1))
    const wpm = (norm(text).length / body.audioSeconds) * 60
    console.log(
      `${speaker}: ${body.audioSeconds.toFixed(1)}s ${wpm.toFixed(0)}wpm wer=${wer(text, body.transcript).toFixed(3)} align=${body.alignment} -> ${dir}`,
    )
  }
} finally {
  stop()
}
