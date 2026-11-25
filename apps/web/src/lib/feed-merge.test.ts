import { describe, expect, it } from 'vitest'
import { pinCurrentFirst } from './feed-merge'

const a = { id: 'a' }
const b = { id: 'b' }
const c = { id: 'c' }

describe('pinCurrentFirst', () => {
  it('keeps the reel on screen first and drops its duplicate from the incoming list', () => {
    expect(pinCurrentFirst(a, [b, a, c])).toEqual([a, b, c])
  })

  it('returns the incoming list when nothing is on screen', () => {
    expect(pinCurrentFirst(undefined, [b])).toEqual([b])
  })

  it('keeps the current reel when the incoming list is empty', () => {
    expect(pinCurrentFirst(a, [])).toEqual([a])
  })
})
