import { useState } from 'react'
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileText,
  Globe,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import type { ClaraSessionMessageAssistantTool, ClaraToolContent } from '@clara/api-contract'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

function toolIcon(name: string) {
  switch (name) {
    case 'shell':
    case 'bash':
      return Terminal
    case 'read':
    case 'write':
    case 'edit':
    case 'patch':
      return FileText
    case 'grep':
    case 'glob':
      return Search
    case 'webfetch':
    case 'websearch':
      return Globe
    default:
      return Wrench
  }
}

function renderContent(content: ClaraToolContent[] | undefined) {
  if (!content?.length) return null
  return (
    <div className="space-y-2">
      {content.map((item, index) =>
        item.type === 'text' ? (
          <pre
            key={index}
            className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed"
          >
            {item.text}
          </pre>
        ) : (
          <a
            key={index}
            href={item.uri}
            target="_blank"
            rel="noreferrer"
            className="block truncate rounded-md border px-2 py-1 text-[11px] underline"
          >
            {item.name ?? item.uri}
          </a>
        )
      )}
    </div>
  )
}

export function ToolCard({ tool }: { tool: ClaraSessionMessageAssistantTool }) {
  const [open, setOpen] = useState(tool.state.status === 'error')
  const Icon = toolIcon(tool.name)
  const status = tool.state.status
  const duration = tool.time.completed
    ? formatDuration(tool.time.created, tool.time.completed)
    : undefined

  const input =
    tool.state.status === 'streaming' ? tool.state.input : JSON.stringify(tool.state.input, null, 2)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2">
      <div className="overflow-hidden rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50"
          >
            <ChevronRight
              className={cn(
                'size-3.5 text-muted-foreground transition-transform',
                open && 'rotate-90'
              )}
            />
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="font-mono font-medium">{tool.name}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {typeof tool.state.input === 'object' && tool.state.input !== null
                ? summarizeInput(tool.state.input as Record<string, unknown>)
                : ''}
            </span>
            {duration && <span className="text-[10px] text-muted-foreground">{duration}</span>}
            <StatusBadge status={status} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-2">
            {input && input !== '{}' && (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Input
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px]">
                  {input}
                </pre>
              </div>
            )}

            {tool.state.status === 'completed' && renderContent(tool.state.content)}

            {tool.state.status === 'error' && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
                {tool.state.error.message}
              </div>
            )}

            {tool.state.status === 'running' && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Running…
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function StatusBadge({ status }: { status: ClaraSessionMessageAssistantTool['state']['status'] }) {
  if (status === 'completed') {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] text-emerald-500">
        <CircleCheck className="size-3" /> done
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] text-destructive">
        <CircleAlert className="size-3" /> failed
      </Badge>
    )
  }
  if (status === 'running') {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <Loader2 className="size-3 animate-spin" /> running
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      preparing
    </Badge>
  )
}

function summarizeInput(input: Record<string, unknown>): string {
  for (const key of ['command', 'path', 'pattern', 'query', 'url', 'description']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  const first = Object.values(input)[0]
  return typeof first === 'string' ? first : ''
}
