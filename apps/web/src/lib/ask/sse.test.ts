import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse'

describe('createSseParser', () => {
  it('emits one payload per event across arbitrary chunk boundaries and CRLF', () => {
    const out: string[] = []
    const parser = createSseParser((d) => out.push(d))
    parser.push('data: {"a":1}\r')
    parser.push('\n\r\ndata: {"b"')
    parser.push(':2}\n\n: comment\n\n')
    parser.end()
    expect(out).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('flushes a final event without a trailing blank line', () => {
    const out: string[] = []
    const parser = createSseParser((d) => out.push(d))
    parser.push('data: tail')
    parser.end()
    expect(out).toEqual(['tail'])
  })
})
