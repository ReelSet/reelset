// cookie@1 sets __esModule with no default export, so esbuild resolves the OpenNext
// converters' `import cookieParser from "cookie"` to undefined and every request that
// carries a Cookie header throws (Cloudflare 1101). A namespace import has `.parse`.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const DEFAULT_IMPORT = /import\s+cookieParser\s+from\s+["']cookie["'];?/
const NAMESPACE_IMPORT = 'import * as cookieParser from "cookie";'

/** @param {string} src */
export function patchCookieImport(src) {
  return src.replace(DEFAULT_IMPORT, NAMESPACE_IMPORT)
}

export const CONVERTERS = ['edge.js', 'node.js']

function main() {
  const require = createRequire(import.meta.url)
  const cfPkg = require.resolve('@opennextjs/cloudflare/package.json')
  const fromCf = createRequire(cfPkg)
  for (const name of CONVERTERS) {
    const file = fromCf.resolve(`@opennextjs/aws/overrides/converters/${name}`)
    const before = readFileSync(file, 'utf8')
    const after = patchCookieImport(before)
    if (after !== before) writeFileSync(file, after)
    if (!after.includes(NAMESPACE_IMPORT)) {
      throw new Error(`patch-opennext-cookie: cookie import not found in ${file}`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
