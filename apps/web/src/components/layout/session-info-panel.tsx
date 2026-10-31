import { useMemo } from 'react'
import { BarChart3, Coins, MessagesSquare, Timer } from 'lucide-react'
import type { SessionInfo } from '@opencode/client'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useModels } from '@/features/catalog/use-catalog'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import { useSessionContext } from '@/features/chat/use-session-context'
import { useSessionWording } from '@/features/sessions/use-wording'
import {
  contextPercent,
  formatCost,
  formatCount,
  formatDateTime,
  formatDuration,
  formatTokens,
} from '@/lib/format'
import { cn } from '@/lib/utils'

export function SessionInfoPanel({
  session,
  snapshot,
}: {
  session: SessionInfo | undefined
  snapshot: ChatSnapshot
}) {
  const contextQuery = useSessionContext(session?.id ?? '', Boolean(session))
  const { singular } = useSessionWording()
  const modelsQuery = useModels()
  const model = modelsQuery.data?.find(
    (item) => item.modelID === session?.model?.id && item.providerID === session?.model?.providerID
  )

  const latest = useMemo(() => {
    for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
      const message = snapshot.messages[index]
      if (message.type === 'assistant' && message.tokens) return message
    }
    return undefined
  }, [snapshot.messages])

  const counts = useMemo(() => {
    const messages = contextQuery.data ?? []
    let user = 0
    let assistant = 0
    let tools = 0
    for (const message of messages) {
      if (message.type === 'user') user += 1
      if (message.type === 'assistant') {
        assistant += 1
        tools += message.content.filter((part) => part.type === 'tool').length
      }
    }
    return { user, assistant, tools, total: messages.length }
  }, [contextQuery.data])

  const tokens = snapshot.tokens ?? session?.tokens
  const cost = snapshot.cost || session?.cost || 0
  const contextTokens = latest
    ? latest.tokens!.input + latest.tokens!.cache.read + latest.tokens!.cache.write
    : tokens?.input
  const limit = model?.limit.context
  const percent = contextPercent(contextTokens, limit)

  return (
    <div className="text-xs">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 font-medium">
          <BarChart3 className="size-3.5 text-muted-foreground" /> {singular} info
        </div>
        <p className="truncate text-[10px] text-muted-foreground">{session?.id ?? 'loading'}</p>
      </div>

      <Separator className="my-3" />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MessagesSquare className="size-3.5" /> Context
          </span>
          <span className="font-mono text-[10px]">
            {formatTokens(contextTokens)} / {limit ? formatTokens(limit) : '—'}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full bg-foreground/70 transition-all',
              percent > 85 && 'bg-destructive'
            )}
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{percent}% used</span>
          <span>{formatTokens(latest?.tokens?.output)} output</span>
        </div>
      </div>

      <Separator className="my-3" />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Coins className="size-3.5" /> Cost
          </span>
          <span className="font-mono">{formatCost(cost)}</span>
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
          <span>input</span>
          <span className="text-right font-mono">{formatTokens(tokens?.input)}</span>
          <span>output</span>
          <span className="text-right font-mono">{formatTokens(tokens?.output)}</span>
          <span>reasoning</span>
          <span className="text-right font-mono">{formatTokens(tokens?.reasoning)}</span>
          <span>cache read</span>
          <span className="text-right font-mono">{formatTokens(tokens?.cache.read)}</span>
          <span>cache write</span>
          <span className="text-right font-mono">{formatTokens(tokens?.cache.write)}</span>
        </div>
      </div>

      <Separator className="my-3" />

      <div className="space-y-2">
        <div className="text-muted-foreground">Messages</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <span>from you</span>
          <span className="text-right font-mono">{formatCount(counts.user)}</span>
          <span>from agent</span>
          <span className="text-right font-mono">{formatCount(counts.assistant)}</span>
          <span>tool calls</span>
          <span className="text-right font-mono">{formatCount(counts.tools)}</span>
          <span>total context</span>
          <span className="text-right font-mono">{formatCount(counts.total)}</span>
        </div>
      </div>

      <Separator className="my-3" />

      <div className="space-y-2 text-[10px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Timer className="size-3.5" /> Timing
        </div>
        <Row label="created" value={formatDateTime(session?.time.created)} />
        <Row label="updated" value={formatDateTime(session?.time.updated)} />
        <Row
          label="duration"
          value={
            session
              ? formatDuration(session.time.created, session.time.idle ?? session.time.updated)
              : '—'
          }
        />
      </div>

      <Separator className="my-3" />

      <div className="space-y-2">
        <div className="text-muted-foreground">Model</div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {session?.model?.id ?? 'default'}
          </Badge>
          {session?.model?.variant && (
            <Badge variant="outline" className="text-[10px]">
              {session.model.variant}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {session?.agent ?? 'build'}
          </Badge>
        </div>
        {model && (
          <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            <span>provider</span>
            <span className="truncate text-right font-mono">{model.providerID}</span>
            <span>context</span>
            <span className="text-right font-mono">{formatTokens(model.limit.context)}</span>
            <span>max output</span>
            <span className="text-right font-mono">{formatTokens(model.limit.output)}</span>
          </div>
        )}
      </div>

      <Separator className="my-3" />

      <div className="space-y-1 text-[10px] text-muted-foreground">
        <div className="truncate">
          <span className="text-foreground/60">dir </span>
          <span className="font-mono">{session?.location.directory ?? '—'}</span>
        </div>
        {session?.parentID && (
          <div className="truncate">
            <span className="text-foreground/60">parent </span>
            <span className="font-mono">{session.parentID}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
