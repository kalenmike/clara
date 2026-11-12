import { z } from 'zod'

export const agentInfoSchema = z.object({
  version: z.string(),
  protocol: z.number(),
  opencodeVersion: z.string().optional(),
  room: z.string().optional(),
  pushPublicKey: z.string().optional(),
  syncEnabled: z.boolean().optional(),
  syncIntervalMs: z.number().optional(),
  orchestration: z.boolean().optional(),
})

export const apiInfoSchema = z.object({
  server: z.object({
    version: z.string(),
    protocol: z.number(),
    startedAt: z.number(),
    pid: z.number(),
  }),
  harness: z.object({
    configured: z.boolean(),
    generation: z.number(),
    active: z
      .object({
        kind: z.string(),
        label: z.string(),
      })
      .nullable(),
    lastError: z.string().nullable(),
  }),
  agent: agentInfoSchema,
  api: z.object({
    version: z.literal('v1'),
    openapi: z.string(),
    docs: z.string(),
  }),
})

export type ApiInfo = z.infer<typeof apiInfoSchema>
