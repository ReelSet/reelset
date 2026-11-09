import { z } from 'zod'

export const saveBodySchema = z.object({ itemId: z.guid(), saved: z.boolean() })
