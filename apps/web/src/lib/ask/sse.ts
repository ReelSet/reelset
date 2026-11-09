export function createSseParser(onData: (data: string) => void) {
  let buffer = ''

  const flush = (block: string) => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data) onData(data)
  }

  return {
    push(chunk: string) {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n')
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        flush(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\n\n')
      }
    },
    end() {
      if (buffer.trim()) flush(buffer)
      buffer = ''
    },
  }
}
