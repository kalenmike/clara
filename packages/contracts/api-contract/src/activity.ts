import { z } from 'zod'
import { claraPlanTodoSchema } from './plan.ts'
import { passthroughObject } from './schema.ts'
import { claraSessionSchema } from './sessions.ts'

/** One paired harness and whether its session lookup succeeded. */
export const claraActivityHarnessSchema = passthroughObject({
  harnessID: z.string(),
  kind: z.string(),
  label: z.string(),
  online: z.boolean(),
  active: z.boolean(),
  ok: z.boolean(),
  createdAt: z.number(),
  code: z.string().optional(),
  message: z.string().optional(),
}).meta({ id: 'ClaraActivityHarness' })

export const claraActivityMailboxSchema = z.enum(['inbox', 'outbox']).meta({
  id: 'ClaraActivityMailbox',
})

/** A session in the Inbox or Outbox, with its current todo plan when available. */
export const claraActivitySessionSchema = passthroughObject({
  harnessID: z.string(),
  session: claraSessionSchema,
  mailbox: claraActivityMailboxSchema,
  todos: z.array(claraPlanTodoSchema).optional(),
  todosUnavailable: z.boolean().optional(),
  /** Plans are loaded for the most recently active sessions, not every row. */
  todosSkipped: z.boolean().optional(),
}).meta({ id: 'ClaraActivitySession' })

export const claraActivitySessionsResponseSchema = passthroughObject({
  data: z.array(claraActivitySessionSchema),
  harnesses: z.array(claraActivityHarnessSchema),
}).meta({ id: 'ClaraActivitySessionsResponse' })

export type ClaraActivityHarness = z.infer<typeof claraActivityHarnessSchema>
export type ClaraActivityMailbox = z.infer<typeof claraActivityMailboxSchema>
export type ClaraActivitySession = z.infer<typeof claraActivitySessionSchema>
export type ClaraActivitySessionsResponse = z.infer<typeof claraActivitySessionsResponseSchema>
