import type { JsonValue, SessionMessageInfo } from '@opencode/client'

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type PlanTodo = {
  content: string
  status: PlanTodoStatus
}

const TODO_TOOL = 'todowrite'
const STATUSES = new Set<PlanTodoStatus>(['pending', 'in_progress', 'completed', 'cancelled'])

/**
 * The v2 API does not expose todos. OpenCode keeps the current list in the
 * input of the newest completed `todowrite` tool call, so read it from the
 * transcript. An empty list means the agent cleared the plan.
 */
export function findPlanTodos(messages: SessionMessageInfo[]): PlanTodo[] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'assistant') continue

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex]
      if (part.type !== 'tool' || part.name !== TODO_TOOL) continue
      if (part.state.status !== 'completed') continue
      return parseTodos(part.state.input.todos)
    }
  }

  return undefined
}

function parseTodos(value: JsonValue | undefined): PlanTodo[] | undefined {
  if (!Array.isArray(value)) return undefined

  const todos: PlanTodo[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const content = item.content
    const status = item.status
    if (typeof content !== 'string' || content.trim().length === 0) continue
    if (typeof status !== 'string' || !STATUSES.has(status as PlanTodoStatus)) continue
    todos.push({ content: content.trim(), status: status as PlanTodoStatus })
  }

  return todos
}
