import { useState } from 'react'
import { Brain, ChevronRight, CircleAlert, Cog, FileText, Sparkles, Terminal } from 'lucide-react'
import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageShell,
} from '@opencode/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Markdown } from '@/components/chat/markdown'
import { ToolCard } from '@/components/chat/tool-card'
import { formatCost, formatDateTime, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export function MessageItem({
  message,
  streaming,
}: {
  message: SessionMessageInfo
  streaming: boolean
}) {
  switch (message.type) {
    case 'user':
      return <UserMessage message={message} />
    case 'assistant':
      return <AssistantMessage message={message} streaming={streaming} />
    case 'shell':
      return <ShellMessage message={message} />
    case 'synthetic':
      return <Note>{message.text}</Note>
    case 'system':
      return <Note>{message.text}</Note>
    case 'skill':
      return (
        <Note>
          <Sparkles className="mr-1 inline size-3" />
          Skill <span className="font-medium">{message.name}</span> activated
        </Note>
      )
    case 'agent-switched':
      return <Note>Agent switched to {message.agent}</Note>
    case 'model-switched':
      return <Note>Model switched to {message.model.id}</Note>
    case 'location-switched':
      return <Note>Location switched</Note>
    case 'compaction':
      return <Note>Context compaction {message.status}</Note>
    case 'idle': {
      return null
    }
    default:
      return null
  }
}

function UserMessage({ message }: { message: Extract<SessionMessageInfo, { type: 'user' }> }) {
  return (
    <div className="flex justify-end px-4 py-1.5">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
        <div className="whitespace-pre-wrap break-words text-sm">{message.text}</div>
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
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  streaming,
}: {
  message: SessionMessageAssistant
  streaming: boolean
}) {
  const hasContent = message.content.some((part) =>
    part.type === 'text'
      ? part.text.trim().length > 0
      : part.type === 'tool'
        ? true
        : part.text.trim().length > 0
  )

  return (
    <div className="px-4 py-1.5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground/80">
          <Cog className="size-3" />
          {message.agent || 'assistant'}
        </span>
        <span>{message.model.id}</span>
        {message.cost ? <span>{formatCost(message.cost)}</span> : null}
        {message.tokens ? (
          <span>
            {formatTokens(message.tokens.input)} in · {formatTokens(message.tokens.output)} out
          </span>
        ) : null}
        <span>{formatDateTime(message.time.created)}</span>
      </div>

      {message.error && (
        <Alert variant="destructive" className="my-2">
          <CircleAlert className="size-4" />
          <AlertTitle>{message.error.type}</AlertTitle>
          <AlertDescription>{message.error.message}</AlertDescription>
        </Alert>
      )}

      {!hasContent && streaming && (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-foreground/50" />
          Thinking…
        </div>
      )}

      <div className={cn('space-y-0.5', streaming && 'min-h-4')}>
        {message.content.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text.trim()) return null
            return <Markdown key={`text-${index}`}>{part.text}</Markdown>
          }
          if (part.type === 'reasoning') {
            if (!part.text.trim()) return null
            return <ReasoningPart key={`reasoning-${index}`} text={part.text} />
          }
          if (part.type === 'tool') {
            return <ToolCard key={`tool-${part.id}-${index}`} tool={part} />
          }
          return null
        })}
      </div>
    </div>
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

function ShellMessage({ message }: { message: SessionMessageShell }) {
  return (
    <div className="px-4 py-1.5">
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
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-2">
      <div className="max-w-[90%] rounded-full border bg-muted/40 px-3 py-1 text-center text-[11px] text-muted-foreground">
        {children}
      </div>
    </div>
  )
}
