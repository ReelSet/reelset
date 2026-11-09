import { createLogger, type Logger } from '@reelset/core'

const globalForLog = globalThis as unknown as { __reelsetLog?: Logger }

export const log: Logger =
  globalForLog.__reelsetLog ??
  (globalForLog.__reelsetLog = createLogger({ app: 'web', level: process.env.LOG_LEVEL ?? 'info' }))

export function routeLog(route: string): Logger {
  return log.child({ route, requestId: crypto.randomUUID() })
}
