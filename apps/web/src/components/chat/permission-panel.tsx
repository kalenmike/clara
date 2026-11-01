import { useState } from 'react'
import { Brain, ChevronRight, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import type { PermissionRequest, SessionMessageInfo } from '@opencode/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Markdown } from '@/components/chat/markdown'
import { findPermissionThinking } from '@/features/chat/permission-thinking'
import { usePendingPermissions, useReplyPermission } from '@/features/chat/use-permissions'
import { cn } from '@/lib/utils'

export function PermissionPanel({
  sessionID,
  directory,
  messages,
}: {
  sessionID: string
  directory: string | undefined
  messages: SessionMessageInfo[]
}) {
  const permissionsQuery = usePendingPermissions(directory)
  const reply = useReplyPermission()
  const requests = (permissionsQuery.data ?? []).filter(
    (request) => request.sessionID === sessionID
  )

  if (requests.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 border-b bg-amber-500/5 p-2 md:p-3">
      {requests.map((request) => (
        <div
          key={request.id}
          className="mx-auto max-w-3xl rounded-xl border border-amber-500/30 bg-card p-3"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">Permission required</span>
                <Badge variant="outline" className="text-[10px]">
                  {request.action}
                </Badge>
              </div>
              {request.message && (
                <p className="mt-1 text-[11px] text-muted-foreground">{request.message}</p>
              )}
              <div className="mt-2 space-y-1">
                {request.resources.map((resource) => (
                  <code
                    key={resource}
                    className="block max-h-20 overflow-auto rounded-md bg-muted/60 px-2 py-1 font-mono text-[10px]"
                  >
                    {resource}
                  </code>
                ))}
              </div>
              <PermissionThinking request={request} messages={messages} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
                  onClick={() =>
                    reply.mutate({ sessionID, requestID: request.id, decision: 'once' })
                  }
                  disabled={reply.isPending}
                >
                  <ShieldCheck className="size-3.5 max-md:size-5" /> Allow once
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
                  onClick={() =>
                    reply.mutate({ sessionID, requestID: request.id, decision: 'always' })
                  }
                  disabled={reply.isPending}
                >
                  Always allow
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive max-md:h-11 max-md:px-3 max-md:text-sm"
                  onClick={() =>
                    reply.mutate({ sessionID, requestID: request.id, decision: 'reject' })
                  }
                  disabled={reply.isPending}
                >
                  <ShieldX className="size-3.5 max-md:size-5" /> Reject
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function PermissionThinking({
  request,
  messages,
}: {
  request: PermissionRequest
  messages: SessionMessageInfo[]
}) {
  const [open, setOpen] = useState(false)
  const thinking = findPermissionThinking(messages, request)
  if (!thinking) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground max-md:min-h-11 max-md:text-xs"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('size-3 transition-transform max-md:size-4', open && 'rotate-90')}
          />
          <Brain aria-hidden="true" className="size-3 max-md:size-4" />
          Agent&apos;s thinking
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 max-h-48 overflow-auto rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground">
          <Markdown className="text-xs">{thinking}</Markdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
