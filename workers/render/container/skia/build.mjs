import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@napi-rs/canvas'],
  alias: { '@plan': path.join(here, '../remotion/src') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
}
await build({ ...common, entryPoints: [path.join(here, 'src/main.ts')], outfile: path.join(here, 'dist/render.mjs') })
if (process.argv.includes('--haiku'))
  await build({ ...common, entryPoints: [path.join(here, 'src/haiku/run.ts')], outfile: path.join(here, 'dist/haiku.mjs'), external: ['@napi-rs/canvas', '@anthropic-ai/sdk'] })
