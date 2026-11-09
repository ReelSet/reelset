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

export const topicsBodySchema = z.object({
  topics: z.array(z.enum(TOPICS)).min(1).max(8),
})
