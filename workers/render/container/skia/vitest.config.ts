import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@plan': path.resolve(__dirname, '../remotion/src') } },
  test: { include: ['src/**/*.test.ts'] },
})
