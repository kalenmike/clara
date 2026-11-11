import { z } from 'zod'

export const apiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ApiError' })

export type ApiErrorBody = z.infer<typeof apiErrorSchema>

export const errorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: apiErrorSchema,
    },
  },
} as const
