import { z } from 'zod'
import { claraPlanTodoSchema } from './plan.ts'
import { passthroughObject } from './schema.ts'
import { claraSessionSchema } from './sessions.ts'

/** One paired harness and whether its running-session lookup succeeded. */
export const claraActivityHarnessSchema = passthroughObject({
  harnessID: z.string(),
  kind: z.string(),
  label: z.string(),
  online: z.boolean(),
  active: z.boolean(),
  ok: z.boolean(),
  code: z.string().optional(),
  message: z.string().optional(),
}).meta({ id: 'ClaraActivityHarness' })

/** A session that is running now, with its current todo plan when available. */
export const claraRunningSessionSchema = passthroughObject({
  harnessID: z.string(),
  session: claraSessionSchema,
  todos: z.array(claraPlanTodoSchema).optional(),
  todosUnavailable: z.boolean().optional(),
}).meta({ id: 'ClaraRunningSession' })

export const claraRunningSessionsResponseSchema = passthroughObject({
  data: z.array(claraRunningSessionSchema),
  harnesses: z.array(claraActivityHarnessSchema),
}).meta({ id: 'ClaraRunningSessionsResponse' })

export type ClaraActivityHarness = z.infer<typeof claraActivityHarnessSchema>
export type ClaraRunningSession = z.infer<typeof claraRunningSessionSchema>
export type ClaraRunningSessionsResponse = z.infer<typeof claraRunningSessionsResponseSchema>
