import { useEffect, useState } from 'react'
import {
  Bot,
  Brain,
  ChevronRight,
  CircleAlert,
  FileText,
  Sparkles,
  Terminal,
  User,
  Zap,
} from 'lucide-react'
import type {
  ClaraSessionMessageAssistant,
  ClaraSessionMessage,
  ClaraSessionMessageShell,
} from '@clara/api-contract'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Markdown } from '@/components/chat/markdown'
import { MarkdownSelectionProvider } from '@/components/chat/markdown-selection'
import { MessageActions } from '@/components/chat/message-actions'
import { ToolCard } from '@/components/chat/tool-card'
import { isSyntheticMessage } from '@/features/chat/message-attribution'
import { assistantHasContent, assistantHasFailed } from '@/features/chat/message-visibility'
import { formatUsageSummary, type UsageSummary } from '@/features/chat/usage-summary'
import type { DisplayCost } from '@/features/cost/estimate'
import { formatCost, formatDateTime, formatRelativeTime, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export type MessageItemActions = {
  onFork: () => void
  onForward: () => void
  onSelect?: () => void
  onForwardSelection?: (text: string) => void
  canFork: boolean
  canForward: boolean
  canSelect?: boolean
  selecting?: boolean
  disabled?: boolean
}

export function MessageItem({
  message,
  streaming,
  showInternal,
  usageSummary,
  displayCost,
  collapsed = false,
  actions,
  onToggle,
}: {
  message: ClaraSessionMessage
  streaming: boolean
  showInternal: boolean
  usageSummary?: UsageSummary
  displayCost?: DisplayCost
  collapsed?: boolean
  actions?: MessageItemActions
  onToggle?: () => void
}) {
  switch (message.type) {
    case 'user':
      return (
        <UserMessage
          message={message}
          collapsed={collapsed}
          actions={actions}
          onToggle={onToggle}
        />
      )
    case 'assistant':
      return (
        <AssistantMessage
          message={message}
          streaming={streaming}
          showInternal={showInternal}
          usageSummary={usageSummary}
          displayCost={displayCost}
          collapsed={collapsed}
          actions={actions}
          onToggle={onToggle}
        />
      )
    case 'shell':
      return <ShellMessage message={message} collapsed={collapsed} onToggle={onToggle} />
    case 'synthetic':
      return <Note>{message.text}</Note>
    case 'skill':
      return (
        <Note>
          <Sparkles className="size-3" />
          Skill <span className="font-medium">{message.name}</span> activated
        </Note>
      )
    case 'model-switched':
      return <Note>Model switched to {message.model.id}</Note>
    case 'location-switched':
      return <Note>Location switched</Note>
    case 'compaction':
      return <Note>Context compaction {message.status}</Note>
    case 'agent-switched':
    case 'system':
    case 'idle':
      return null
    default:
      return null
  }
}

function MessageRow({
  role,
  sender,
  senderSuffix,
  timestamp,
  meta,
  collapsed,
  preview,
  actions,
  onToggle,
  children,
}: {
  role: 'user' | 'agent' | 'automation'
  sender: string
  senderSuffix?: React.ReactNode
  timestamp: number
  meta?: string
  collapsed: boolean
  preview: string
  actions?: MessageItemActions
  onToggle?: () => void
  children: React.ReactNode
}) {
  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => {
        if (open === collapsed) onToggle?.()
      }}
    >
      <article className="group/row px-2 py-1 sm:px-4">
        <div className="flex items-start gap-1">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={collapsed ? `Expand ${sender} message` : `Collapse ${sender} message`}
              className={cn(
                'flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg px-2 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed && 'hover:bg-accent/40'
              )}
            >
              <div className="flex w-full items-start gap-3">
                <MessageAvatar role={role} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{sender}</span>
                    {senderSuffix}
                  </div>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={new Date(timestamp).toISOString()}
                  >
                    {formatDateTime(timestamp)} ({formatRelativeTime(timestamp)})
                  </time>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                    !collapsed && 'rotate-90'
                  )}
                />
              </div>

              {collapsed && preview ? (
                <p className="w-full truncate pl-12 text-xs text-muted-foreground">{preview}</p>
              ) : null}
            </button>
          </CollapsibleTrigger>

          {actions ? <MessageActions {...actions} /> : null}
        </div>

        <CollapsibleContent>
          <div className="pr-2 pb-3 pl-14 text-sm leading-relaxed">{children}</div>

          {meta ? (
            <div className="pr-2 pb-3 pl-14 text-[11px] text-muted-foreground">{meta}</div>
          ) : null}
        </CollapsibleContent>
      </article>
    </Collapsible>
  )
}

function MessageAvatar({ role }: { role: 'user' | 'agent' | 'automation' }) {
  return (
    <Avatar aria-hidden="true" className="size-9">
      <AvatarFallback
        className={cn(
          'font-medium',
          role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        )}
      >
        {role === 'user' ? (
          <User className="size-4" aria-hidden="true" />
        ) : role === 'automation' ? (
          <Zap className="size-4" aria-hidden="true" />
        ) : (
          <Bot className="size-4" aria-hidden="true" />
        )}
      </AvatarFallback>
    </Avatar>
  )
}

function UserMessage({
  message,
  collapsed,
  actions,
  onToggle,
}: {
  message: Extract<ClaraSessionMessage, { type: 'user' }>
  collapsed: boolean
  actions?: MessageItemActions
  onToggle?: () => void
}) {
  const automation = isSyntheticMessage(message)

  return (
    <MessageRow
      role={automation ? 'automation' : 'user'}
      sender={automation ? 'Automation' : 'User'}
      timestamp={message.time.created}
      collapsed={collapsed}
      preview={userPreview(message)}
      actions={actions}
      onToggle={onToggle}
    >
      <Markdown breaks>{message.text}</Markdown>
      {(message.files?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {message.files?.map((file, index) => (
            <Badge key={index} variant="secondary" className="gap-1 text-[10px]">
              <FileText className="size-3" />
              {file.name ?? 'file'}
            </Badge>
          ))}
        </div>
      )}
      {message.agents?.map((agent, index) => (
        <Badge key={index} variant="secondary" className="mt-2 mr-1 text-[10px]">
          @{agent.name}
        </Badge>
      ))}
    </MessageRow>
  )
}

function AssistantMessage({
  message,
  streaming,
  showInternal,
  usageSummary,
  displayCost,
  collapsed,
  actions,
  onToggle,
}: {
  message: ClaraSessionMessageAssistant
  streaming: boolean
  showInternal: boolean
  usageSummary?: UsageSummary
  displayCost?: DisplayCost
  collapsed: boolean
  actions?: MessageItemActions
  onToggle?: () => void
}) {
  const hasContent = assistantHasContent(message, showInternal)
  const thinking = !hasContent && streaming
  const selecting = Boolean(actions?.selecting)
  const exitSelection = actions?.onSelect

  // Selection needs the rendered blocks, so it ends when the message folds or
  // stops being actionable (a new run started or the session changed).
  useEffect(() => {
    if (selecting && (collapsed || actions?.disabled)) exitSelection?.()
  }, [actions?.disabled, collapsed, exitSelection, selecting])

  const costValue = displayCost ? displayCost.value : message.cost
  const costEstimated = displayCost?.estimated ?? false
  const ownUsage = [
    message.tokens
      ? `${formatTokens(message.tokens.input)} in · ${formatTokens(message.tokens.output)} out`
      : null,
    costValue ? formatCost(costValue, { estimated: costEstimated }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const usage = usageSummary ? formatUsageSummary(usageSummary) : ownUsage

  // A visible question-only step can still be waiting for text. Keep usage
  // inline so streaming token counts do not add and remove a footer row, which
  // would jolt the scroll position.
  const inlineUsage = thinking && !showInternal && !usageSummary ? usage : ''

  return (
    <MessageRow
      role="agent"
      sender={message.model.id}
      senderSuffix={
        message.agent ? (
          <Badge
            variant="secondary"
            className="h-4 shrink-0 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground"
            title={`Agent ${message.agent}`}
          >
            <Bot className="size-3" />
            {message.agent}
          </Badge>
        ) : undefined
      }
      timestamp={message.time.created}
      meta={inlineUsage ? '' : usage}
      collapsed={collapsed && !assistantHasFailed(message)}
      preview={assistantPreview(message, showInternal)}
      actions={actions}
      onToggle={onToggle}
    >
      {message.error && (
        <Alert variant="destructive" className="mb-3">
          <CircleAlert className="size-4" />
          <AlertTitle>
            {message.error.type}
            {message.error.status ? ` · HTTP ${message.error.status}` : ''}
          </AlertTitle>
          <AlertDescription>
            <p>{message.error.message}</p>
            {errorHint(message.error.type) && (
              <p className="mt-1 text-xs opacity-80">{errorHint(message.error.type)}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {thinking && (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-foreground/50" />
          <span>Thinking…</span>
          {inlineUsage ? <span>{inlineUsage}</span> : null}
        </div>
      )}

      <MarkdownSelectionProvider
        active={Boolean(selecting) && !actions?.disabled}
        onExit={() => actions?.onSelect?.()}
        onForward={(text) => actions?.onForwardSelection?.(text)}
      >
        <div className={cn('space-y-2', streaming && 'min-h-4')}>
          {message.content.map((part, index) => {
            if (part.type === 'text') {
              if (!part.text.trim()) return null
              return (
                <Markdown key={`text-${index}`} partIndex={textPartIndex(message, index)}>
                  {part.text}
                </Markdown>
              )
            }
            if (part.type === 'reasoning') {
              if (!showInternal || !part.text.trim()) return null
              return <ReasoningPart key={`reasoning-${index}`} text={part.text} />
            }
            if (part.type === 'tool') {
              if (!showInternal) return null
              return <ToolCard key={`tool-${part.id}-${index}`} tool={part} />
            }
            return null
          })}
        </div>
      </MarkdownSelectionProvider>
    </MessageRow>
  )
}

function ReasoningPart({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          <Brain className="size-3" />
          Thinking
          <span className="text-muted-foreground/60">({text.length.toLocaleString()} chars)</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 border-l pl-3 text-[11px] leading-relaxed text-muted-foreground">
          <Markdown className="text-xs">{text}</Markdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function userPreview(message: Extract<ClaraSessionMessage, { type: 'user' }>): string {
  const text = firstLine(message.text)
  if (text) return text
  const files = message.files?.length ?? 0
  if (files > 0) return `${files} attachment${files === 1 ? '' : 's'}`
  return ''
}

function assistantPreview(message: ClaraSessionMessageAssistant, showInternal: boolean): string {
  let reasoning = ''
  for (const part of message.content) {
    if (part.type === 'text') {
      const text = firstLine(part.text)
      if (text) return text
    } else if (part.type === 'tool') {
      if (showInternal) return part.name
    } else if (showInternal && !reasoning) {
      reasoning = firstLine(part.text)
    }
  }
  if (reasoning) return reasoning
  if (message.error) return firstLine(message.error.message)
  return ''
}

function firstLine(text: string): string {
  const line = text.split('\n').find((value) => value.trim().length > 0)
  return line?.trim() ?? ''
}

/** The part index used by the inspector: text parts only, in render order. */
function textPartIndex(message: ClaraSessionMessageAssistant, index: number): number {
  let count = 0
  for (let position = 0; position < index; position += 1) {
    if (message.content[position]?.type === 'text') count += 1
  }
  return count
}

/** Plain-language next step for the provider failures the harness reports most often. */
function errorHint(type: string): string | null {
  if (type === 'provider.auth') {
    return 'Check this provider’s credentials, or switch to another model.'
  }
  if (type === 'provider.quota') {
    return 'This provider account has no available credit. Top up the account or switch models.'
  }
  return null
}

function ShellMessage({
  message,
  collapsed,
  onToggle,
}: {
  message: ClaraSessionMessageShell
  collapsed: boolean
  onToggle?: () => void
}) {
  return (
    <MessageRow
      role="agent"
      sender="Shell"
      timestamp={message.time.created}
      collapsed={collapsed}
      preview={firstLine(message.command)}
      onToggle={onToggle}
    >
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[11px]">
          <Terminal className="size-3.5 text-muted-foreground" />
          <span className="font-mono">{message.command}</span>
          <span className="ml-auto text-muted-foreground">{message.status}</span>
        </div>
        {message.output?.output && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px]">
            {message.output.output}
          </pre>
        )}
      </div>
    </MessageRow>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 text-xs italic text-muted-foreground sm:px-6">
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}
