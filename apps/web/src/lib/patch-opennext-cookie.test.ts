import { describe, expect, it } from 'vitest'
import { patchCookieImport } from '../../scripts/patch-opennext-cookie.mjs'

describe('patchCookieImport', () => {
  it('turns the default cookie import into a namespace import', () => {
    const src = 'import { Buffer } from "node:buffer";\nimport cookieParser from "cookie";\n'
    expect(patchCookieImport(src)).toBe(
      'import { Buffer } from "node:buffer";\nimport * as cookieParser from "cookie";\n',
    )
  })

  it('is idempotent', () => {
    const once = patchCookieImport('import cookieParser from "cookie";')
    expect(patchCookieImport(once)).toBe(once)
  })

  it('leaves other imports alone', () => {
    const src = 'import cookie from "cookie-es";'
    expect(patchCookieImport(src)).toBe(src)
  })
})
