import { describe, expect, it } from 'vitest'
import { PUBLISH_NOTE_MAX_CHARS, publishNoteSchema, publishStateOf } from './publish-review'

describe('publishStateOf', () => {
  it('treats a public reel as live whatever the review says', () => {
    expect(publishStateOf({ visibility: 'public', publishReview: null })).toBe('live')
    expect(publishStateOf({ visibility: 'public', publishReview: 'pending' })).toBe('live')
  })

  it('maps private reels by review status', () => {
    expect(publishStateOf({ visibility: 'private', publishReview: null })).toBe('none')
    expect(publishStateOf({ visibility: 'private', publishReview: 'pending' })).toBe('in_review')
    expect(publishStateOf({ visibility: 'private', publishReview: 'rejected' })).toBe('rejected')
    expect(publishStateOf({ visibility: 'private', publishReview: 'approved' })).toBe('none')
  })

  it('never exposes hidden or unknown visibility as submittable or live', () => {
    expect(publishStateOf({ visibility: 'hidden', publishReview: 'pending' })).toBe('none')
    expect(publishStateOf({ visibility: 'weird', publishReview: 'pending' })).toBe('none')
  })
})

describe('publishNoteSchema', () => {
  it('trims, nulls blanks and caps length', () => {
    expect(publishNoteSchema.parse('  needs a better source ')).toBe('needs a better source')
    expect(publishNoteSchema.parse('   ')).toBeNull()
    expect(publishNoteSchema.safeParse('x'.repeat(PUBLISH_NOTE_MAX_CHARS + 1)).success).toBe(false)
  })
})
