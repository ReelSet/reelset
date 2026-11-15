import { z } from 'zod'
import { parseVisibility } from './visibility'

export const PUBLISH_REVIEWS = ['pending', 'approved', 'rejected'] as const
export type PublishReview = (typeof PUBLISH_REVIEWS)[number]

export const PUBLISH_NOTE_MAX_CHARS = 300

export const publishNoteSchema = z
  .string()
  .trim()
  .max(PUBLISH_NOTE_MAX_CHARS)
  .transform((note) => note || null)

export const PUBLISH_STATES = ['none', 'in_review', 'live', 'rejected'] as const
export type PublishState = (typeof PUBLISH_STATES)[number]

export type PublishStateInput = {
  visibility: string
  publishReview: string | null
}

// Visibility wins: a public reel is live however it got there, and an approved-then-unpublished one is back to none.
export function publishStateOf(input: PublishStateInput): PublishState {
  const visibility = parseVisibility(input.visibility)
  if (visibility === 'public') return 'live'
  if (visibility === 'hidden') return 'none'
  if (input.publishReview === 'pending') return 'in_review'
  if (input.publishReview === 'rejected') return 'rejected'
  return 'none'
}
