import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ChatHeader } from '@/components/chat/chat-header'
import { Composer } from '@/components/chat/composer'
import { FormPanel } from '@/components/chat/form-panel'
import { MessageList } from '@/components/chat/message-list'
import { PermissionPanel } from '@/components/chat/permission-panel'
import { SessionInfoPanel } from '@/components/layout/session-info-panel'
import { useAgents } from '@/features/catalog/use-catalog'
import {
  useChatSnapshot,
  useCompactSession,
  useInterruptSession,
  useSessionMessages,
  useSwitchAgent,
} from '@/features/chat/use-chat'
import { useProjects } from '@/features/projects/use-projects'
import { useCreateSession, useSession } from '@/features/sessions/use-sessions'
import { useKeybinds } from '@/hooks/use-keybinds'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useConnection } from '@/providers/connection-provider'

export function ChatPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>()
  const navigate = useNavigate()
  const { status } = useConnection()
  const { setTheme, resolvedTheme } = useTheme()
  const projectsQuery = useProjects()
  const project = projectsQuery.data?.find((item) => item.id === projectId)
  const sessionQuery = useSession(sessionId ?? null)
  const session = sessionQuery.data
  const snapshot = useChatSnapshot(sessionId ?? '')
  useSessionMessages(sessionId ?? '')
  const [infoOpen, setInfoOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  )
  const isDesktop = useMediaQuery('(min-width: 1280px)')

  const agentsQuery = useAgents()
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.hidden && agent.mode !== 'subagent'),
    [agentsQuery.data]
  )
  const switchAgent = useSwitchAgent(sessionId ?? '')
  const compact = useCompactSession(sessionId ?? '')
  const interrupt = useInterruptSession(sessionId ?? '')
  const createSession = useCreateSession(project?.canonical ?? '')

  const busy = snapshot.status.type !== 'idle'
  const directory = project?.canonical ?? session?.location.directory

  const copyLastReply = useCallback(() => {
    const last = [...snapshot.messages].reverse().find((message) => message.type === 'assistant')
    if (!last || last.type !== 'assistant') return
    const text = last.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (!text) return
    void navigator.clipboard.writeText(text)
    toast.success('Copied last reply')
  }, [snapshot.messages])

  const cycleAgent = useCallback(
    (direction: 1 | -1) => {
      if (agents.length === 0) return
      const index = agents.findIndex((agent) => agent.id === session?.agent)
      const next = agents[(index + direction + agents.length) % agents.length]
      if (next) switchAgent.mutate(next.id)
    },
    [agents, session?.agent, switchAgent]
  )

  useKeybinds({
    onNewSession: () => {
      if (!project) return
      createSession.mutate(
        { agent: session?.agent, model: session?.model },
        { onSuccess: (created) => navigate(`/p/${project.id}/s/${created.id}`) }
      )
    },
    onSessions: () => {
      if (project) navigate(`/p/${project.id}`)
    },
    onToggleInfo: () => setInfoOpen((open) => !open),
    onCompact: () => {
      if (sessionId && !busy) compact.mutate()
    },
    onCopyReply: copyLastReply,
    onInterrupt: () => {
      if (busy) interrupt.mutate()
    },
    onOpenModels: () => window.dispatchEvent(new Event('clara:open-models')),
    onOpenAgents: () => window.dispatchEvent(new Event('clara:open-agents')),
    onCycleAgent: cycleAgent,
    onCycleVariant: () => window.dispatchEvent(new Event('clara:cycle-variant')),
    onToggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
  })

  if (status !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Connecting…
      </div>
    )
  }

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">No session selected</p>
        <p className="text-xs text-muted-foreground">Pick a session from the sidebar.</p>
      </div>
    )
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading session…
      </div>
    )
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium">Session not found</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It may have been deleted or the server is unreachable.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={projectId ? `/p/${projectId}` : '/'}>
            <ArrowLeft className="size-4" /> Back to sessions
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          session={session}
          snapshot={snapshot}
          projectID={projectId ?? session.projectID}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((open) => !open)}
          onDeleted={() => navigate(`/p/${projectId ?? session.projectID}`)}
        />

        <FormPanel sessionID={sessionId} />
        <PermissionPanel sessionID={sessionId} directory={directory} />

        <MessageList messages={snapshot.messages} streaming={busy} revision={snapshot.revision} />

        <Composer
          sessionID={sessionId}
          directory={directory}
          busy={busy}
          disabled={sessionQuery.isError}
        />
      </div>

      {infoOpen && isDesktop && <SessionInfoPanel session={session} snapshot={snapshot} />}

      {!isDesktop && (
        <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
          <SheetContent side="right" className="w-80 p-0">
            <SheetTitle className="sr-only">Session info</SheetTitle>
            <SheetDescription className="sr-only">Usage, cost, and timing</SheetDescription>
            <SessionInfoPanel session={session} snapshot={snapshot} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
