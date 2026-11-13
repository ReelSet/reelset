import { z } from 'zod'

export const TOPICS = [
  'ai',
  'llms',
  'databases',
  'systems',
  'web',
  'devops',
  'security',
  'languages',
  'mobile',
  'data',
  'open-source',
  'hardware',
] as const

// Picker topics plus any topic slug a viewer followed from a reel.
const topicSlugSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const topicsBodySchema = z.object({
  topics: z.array(topicSlugSchema).min(1).max(8),
})

export const MAX_FOLLOWED_TOPICS = 8

export const followBodySchema = z.object({ topic: topicSlugSchema, following: z.boolean() })
