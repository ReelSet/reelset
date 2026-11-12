type Fields = Record<string, unknown>

function emit(level: string, fields: Fields, msg: string): void {
  process.stderr.write(`${JSON.stringify({ level, msg, ...fields })}\n`)
}

/** Minimal JSON line logger on stderr (stdout carries the progress lines the container keeps). */
export const log = {
  info: (fields: Fields, msg: string) => emit('info', fields, msg),
  warn: (fields: Fields, msg: string) => emit('warn', fields, msg),
  error: (fields: Fields, msg: string) => emit('error', fields, msg),
}
