import pino, { type Logger, type LoggerOptions } from 'pino'

export type { Logger }

export type LoggerConfig = {
  app: string
  level?: LoggerOptions['level']
  pretty?: boolean
}

export function createLogger({ app, level = 'info', pretty = false }: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level,
    redact: {
      paths: [
        '*.apiKey',
        '*.token',
        '*.password',
        '*.connectionString',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[REDACTED]',
    },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { app },
  }

  if (!pretty) return pino(options)

  return pino({
    ...options,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,app',
        singleLine: true,
      },
    },
  })
}

export function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt)
}

export function errorFields(err: unknown): {
  errName: string
  errMessage: string
  errStack?: string
} {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, errStack: err.stack }
  }
  return { errName: 'NonError', errMessage: String(err) }
}
