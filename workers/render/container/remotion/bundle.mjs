import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { ensureBrowser } from '@remotion/renderer'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(root, 'build')

await bundle({
  entryPoint: path.join(root, 'src/index.ts'),
  publicDir: path.join(root, 'public'),
  outDir,
})
await ensureBrowser()
console.log(`bundled to ${outDir}`)
