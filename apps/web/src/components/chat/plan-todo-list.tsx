import { Circle, CircleCheck, CircleDot, CircleSlash } from 'lucide-react'
import type { PlanTodo, PlanTodoStatus } from '@/features/chat/session-plan'
import { cn } from '@clara/ui/lib/utils'

/** Read-only checklist shared by the session Plan dock and running agents. */
export function PlanTodoList({
  todos,
  className,
}: {
  todos: readonly PlanTodo[]
  className?: string
}) {
  return (
    <ul className={cn('space-y-1.5', className)}>
      {todos.map((todo, index) => (
        <PlanTodoRow key={`${index}:${todo.content}`} todo={todo} />
      ))}
    </ul>
  )
}

function PlanTodoRow({ todo }: { todo: PlanTodo }) {
  const Icon = iconFor(todo.status)

  return (
    <li className="flex items-start gap-1.5">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', colorFor(todo.status))} />
      <span
        className={cn(
          'min-w-0 break-words text-[11px] leading-snug',
          todo.status === 'completed' && 'text-muted-foreground line-through',
          todo.status === 'cancelled' && 'text-muted-foreground/60 line-through',
          todo.status === 'in_progress' && 'font-medium'
        )}
      >
        <span className="sr-only">{labelFor(todo.status)}: </span>
        {todo.content}
      </span>
    </li>
  )
}

function iconFor(status: PlanTodoStatus) {
  switch (status) {
    case 'completed':
      return CircleCheck
    case 'in_progress':
      return CircleDot
    case 'cancelled':
      return CircleSlash
    default:
      return Circle
  }
}

function colorFor(status: PlanTodoStatus): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-500'
    case 'in_progress':
      return 'text-amber-500'
    case 'cancelled':
      return 'text-muted-foreground/50'
    default:
      return 'text-muted-foreground'
  }
}

function labelFor(status: PlanTodoStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'in_progress':
      return 'In progress'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Pending'
  }
}
