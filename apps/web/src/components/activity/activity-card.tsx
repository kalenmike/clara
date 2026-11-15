import { Link } from 'react-router'
import { ArrowUpRight, ListTodo } from 'lucide-react'
import type { ClaraActivityHarness, ClaraActivitySession } from '@clara/api-contract'
import { PlanTodoList } from '@/components/chat/plan-todo-list'
import { Badge } from '@clara/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@clara/ui/components/card'
import { formatCost, formatRelativeTime, formatTokens } from '@/lib/format'

export function ActivityCard({
  item,
  harness,
  projectName,
  href,
}: {
  item: ClaraActivitySession
  harness: ClaraActivityHarness
  projectName: string
  href: string | null
}) {
  const { session, todos } = item
  const title = session.title || 'Untitled session'
  const done = todos?.filter((todo) => todo.status === 'completed').length ?? 0
  const total = todos?.length ?? 0
  const totalTokens =
    session.tokens.input +
    session.tokens.output +
    session.tokens.reasoning +
    session.tokens.cache.read +
    session.tokens.cache.write
  const tokenDetail = [
    `${formatTokens(session.tokens.input)} in`,
    `${formatTokens(session.tokens.output)} out`,
    `${formatTokens(session.tokens.reasoning)} reasoning`,
    `${formatTokens(session.tokens.cache.read)} cache read`,
    `${formatTokens(session.tokens.cache.write)} cache write`,
  ].join(' · ')

  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm leading-snug">
          {href ? (
            <Link to={href} className="inline-flex items-start gap-1 hover:underline">
              <span className="line-clamp-2">{title}</span>
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </Link>
          ) : (
            <span className="line-clamp-2">{title}</span>
          )}
        </CardTitle>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">
            {harness.label}
          </Badge>
          <Badge variant={item.mailbox === 'inbox' ? 'default' : 'outline'} className="text-[10px]">
            {item.mailbox === 'inbox' ? 'Inbox' : 'Outbox'}
          </Badge>
          <span className="truncate">{projectName}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {session.agent ?? 'build'}
          </Badge>
          <Badge variant="outline" className="max-w-[14rem] truncate text-[10px]">
            {session.model?.id ?? 'default model'}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground">
            updated {formatRelativeTime(session.time.updated)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="font-mono" title={tokenDetail}>
            {formatTokens(totalTokens)} tokens
          </span>
          <span className="font-mono">{formatCost(session.cost)}</span>
        </div>

        <div className="border-t pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <ListTodo className="size-3.5 text-muted-foreground" /> Plan
            </span>
            {total > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {done}/{total}
              </span>
            )}
          </div>

          {item.todosUnavailable ? (
            <p className="text-[10px] text-muted-foreground">Plan unavailable.</p>
          ) : item.todosSkipped ? (
            <p
              className="text-[10px] text-muted-foreground"
              title="Plans load for Outbox and recently updated sessions."
            >
              Plan not loaded.
            </p>
          ) : todos && todos.length > 0 ? (
            <PlanTodoList todos={todos} className="max-h-40 overflow-y-auto pr-1" />
          ) : (
            <p className="text-[10px] text-muted-foreground">No plan yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
