import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@napi-rs/canvas', '@anthropic-ai/sdk'],
  alias: { '@plan': path.join(here, 'src/planner') },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
}
const entries = { 'render.mjs': 'src/director/orchestrator.ts', 'draw.mjs': 'src/draw.ts' }
for (const [out, entry] of Object.entries(entries))
  await build({
    ...common,
    entryPoints: [path.join(here, entry)],
    outfile: path.join(here, 'dist', out),
  })
