import { z } from 'zod'
import { passthroughObject } from './schema.ts'

export const claraPlanTodoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
])

export type ClaraPlanTodoStatus = z.infer<typeof claraPlanTodoStatusSchema>

export const claraPlanTodoSchema = passthroughObject({
  content: z.string(),
  status: claraPlanTodoStatusSchema,
}).meta({ id: 'ClaraPlanTodo' })

export type ClaraPlanTodo = z.infer<typeof claraPlanTodoSchema>

// `findPlanTodos` lives in `plan-todos.ts` so the browser can read a plan
// without pulling these schemas (and zod) into its bundle.
