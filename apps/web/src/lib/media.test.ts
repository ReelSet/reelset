import { describe, expect, it } from 'vitest'
import { mediaUrl } from './media'
import { parseSessionId } from './session'

describe('mediaUrl', () => {
  it('joins base and key with a single slash', () => {
    expect(mediaUrl('https://cdn.test/', '/reels/a.mp4')).toBe('https://cdn.test/reels/a.mp4')
    expect(mediaUrl('https://cdn.test', 'reels/a.mp4')).toBe('https://cdn.test/reels/a.mp4')
    expect(mediaUrl('https://cdn.test', null)).toBeNull()
  })
})

describe('parseSessionId', () => {
  it('accepts uuid-like ids only', () => {
    expect(parseSessionId('0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b')).not.toBeNull()
    expect(parseSessionId('short')).toBeNull()
    expect(parseSessionId('bad id with spaces')).toBeNull()
    expect(parseSessionId(undefined)).toBeNull()
  })
})
