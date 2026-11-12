import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@plan': path.resolve(__dirname, 'src/planner') } },
  test: { include: ['src/**/*.test.ts'] },
})
