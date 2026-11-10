import { describe, expect, it } from 'vitest'
import { postBadge } from './status'

describe('postBadge', () => {
  it('labels every state and defaults to not posted', () => {
    expect(postBadge(null).label).toBe('Not posted')
    expect(postBadge('posted').label).toBe('Posted')
    expect(postBadge('queued').label).toBe('Queued')
    expect(postBadge('mystery').label).toBe('Not posted')
  })

  it('shows a pending delete on a posted reel', () => {
    expect(postBadge('posted', true).label).toBe('Delete queued')
  })
})
