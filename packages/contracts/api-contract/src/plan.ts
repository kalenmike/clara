import { z } from 'zod'
import type { ClaraJsonValue } from './json.ts'
import type { ClaraSessionMessage } from './messages.ts'
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

const TODO_TOOL = 'todowrite'
const STATUSES = new Set<ClaraPlanTodoStatus>(['pending', 'in_progress', 'completed', 'cancelled'])

/**
 * The harness API does not expose todos. The current list lives in the input of
 * the newest completed `todowrite` tool call, so read it from the transcript.
 * An empty list means the agent cleared the plan.
 *
 * A fork copies the parent's transcript, including its `todowrite` calls, but
 * the copies keep the parent's creation times. `forkedAt` is the child's
 * creation time: plans written before it belong to the parent and stay hidden
 * so the branch starts with its own checklist.
 */
export function findPlanTodos(
  messages: ClaraSessionMessage[],
  options: { forkedAt?: number } = {}
): ClaraPlanTodo[] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'assistant') continue

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex]
      if (part.type !== 'tool' || part.name !== TODO_TOOL) continue
      if (part.state.status !== 'completed') continue
      if (options.forkedAt !== undefined && message.time.created < options.forkedAt) {
        return undefined
      }
      return parseTodos(part.state.input.todos)
    }
  }

  return undefined
}

function parseTodos(value: ClaraJsonValue | undefined): ClaraPlanTodo[] | undefined {
  if (!Array.isArray(value)) return undefined

  const todos: ClaraPlanTodo[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const content = item.content
    const status = item.status
    if (typeof content !== 'string' || content.trim().length === 0) continue
    if (typeof status !== 'string' || !STATUSES.has(status as ClaraPlanTodoStatus)) continue
    todos.push({ content: content.trim(), status: status as ClaraPlanTodoStatus })
  }

  return todos
}
