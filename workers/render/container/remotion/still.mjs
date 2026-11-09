// node still.mjs <jobDir> <outDir> <seconds...>: design iteration, renders single frames of a job's props
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const root = path.dirname(fileURLToPath(import.meta.url))
const [jobDir, outDir, ...seconds] = process.argv.slice(2)
const props = JSON.parse(fs.readFileSync(path.join(jobDir, 'props.json'), 'utf8'))
const serveUrl = await bundle({
  entryPoint: path.join(root, 'src/index.ts'),
  publicDir: path.join(root, 'public'),
  outDir: path.join(root, '.still-bundle'),
})
const stage = path.join(serveUrl, 'public', 'job')
fs.rmSync(stage, { recursive: true, force: true })
fs.cpSync(path.join(jobDir, 'assets'), stage, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
const composition = await selectComposition({ serveUrl, id: 'Reel', inputProps: props })
for (const s of seconds) {
  await renderStill({
    composition,
    serveUrl,
    inputProps: props,
    frame: Math.round(Number(s) * 30),
    output: path.join(outDir, `s_${String(s).padStart(5, '0')}.png`),
  })
}
console.log('stills done')
