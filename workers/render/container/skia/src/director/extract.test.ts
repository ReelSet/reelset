import { describe, expect, it } from 'vitest'
import { extractCode } from './extract'

describe('extractCode', () => {
  it('returns the body of a js block', () => {
    expect(extractCode('Here:\n```js\nreturn []\n```\nDone')).toBe('return []\n')
  })

  it('takes the longest of several blocks', () => {
    const text = '```js\nshort()\n```\ntext\n```javascript\nconst longer = 1\nreturn [longer]\n```'
    expect(extractCode(text)).toBe('const longer = 1\nreturn [longer]\n')
  })

  it('accepts a bare fence and CRLF line endings', () => {
    expect(extractCode('```\r\nreturn 1\r\n```')).toBe('return 1\r\n')
  })

  it('ignores an unterminated trailing block from a truncated reply', () => {
    const text = '```js\nconst a = 1\nreturn [a]\n```\nrevised:\n```js\nconst b = 2\nreturn [b'
    expect(extractCode(text)).toBe('const a = 1\nreturn [a]\n')
  })

  it('returns null when only a truncated block exists', () => {
    expect(extractCode('```js\nconst a = 1\nreturn [')).toBeNull()
  })

  it('returns null for an empty block or plain text', () => {
    expect(extractCode('```js\n\n```')).toBeNull()
    expect(extractCode('I cannot help with that.')).toBeNull()
  })
})
