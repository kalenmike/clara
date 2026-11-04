import { BarChart3, GitBranch, SquareTerminal, X } from 'lucide-react'
import type { SessionInfo, SessionMessageInfo } from '@opencode/client'
import { PairTerminal } from '@/components/chat/pair-terminal'
import { GitPanel } from '@/components/layout/git-panel'
import { SessionInfoPanel } from '@/components/layout/session-info-panel'
import { SessionPlanDock } from '@/components/layout/session-plan-dock'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import { useSidePanelWidth } from '@/hooks/use-side-panel-width'
import { SIDE_PANEL_WIDTH_MAX, SIDE_PANEL_WIDTH_MIN, type SidePanelTab } from '@/lib/storage'
import { cn } from '@/lib/utils'

export function SidePanel({
  session,
  snapshot,
  messages,
  directory,
  projectID,
  canonical,
  draft,
  tab,
  onTabChange,
  onClose,
  resizable = true,
  className,
}: {
  session: SessionInfo | undefined
  snapshot: ChatSnapshot
  messages: SessionMessageInfo[]
  directory: string | undefined
  projectID: string | undefined
  canonical: string | undefined
  draft: boolean
  tab: SidePanelTab
  onTabChange: (tab: SidePanelTab) => void
  /** Shown as an in-panel close control when the panel is a sheet. */
  onClose?: () => void
  resizable?: boolean
  className?: string
}) {
  const { width, dragging, handleProps } = useSidePanelWidth()

  return (
    <aside
      style={resizable ? { width } : undefined}
      className={cn(
        'relative flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden border-l bg-sidebar/40 text-xs',
        className
      )}
    >
      {resizable && (
        <div
          {...handleProps}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
          aria-valuenow={width}
          aria-valuemin={SIDE_PANEL_WIDTH_MIN}
          aria-valuemax={SIDE_PANEL_WIDTH_MAX}
          tabIndex={0}
          className={cn(
            'group absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none outline-none',
            'focus-visible:bg-primary/10'
          )}
        >
          <div
            className={cn(
              'absolute inset-y-0 left-0 w-px transition-colors',
              dragging
                ? 'bg-primary'
                : 'bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-primary'
            )}
          />
        </div>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as SidePanelTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex shrink-0 items-center gap-1 border-b p-2">
          <TabsList className="min-w-0 flex-1 max-md:h-[51px]!">
            <TabsTrigger value="info" className="text-[11px]">
              <BarChart3 className="size-3.5" />
              Info
            </TabsTrigger>
            <TabsTrigger value="git" className="text-[11px]">
              <GitBranch className="size-3.5" />
              Git
            </TabsTrigger>
            <TabsTrigger value="terminal" className="text-[11px]">
              <SquareTerminal className="size-3.5" />
              Terminal
            </TabsTrigger>
          </TabsList>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="Close panel"
              className="shrink-0 max-md:size-11"
            >
              <X className="size-4 max-md:size-5" />
              <span className="sr-only">Close panel</span>
            </Button>
          )}
        </div>
        <TabsContent value="info" className="min-h-0 flex-1 overflow-y-auto p-3">
          <SessionInfoPanel session={session} snapshot={snapshot} />
        </TabsContent>
        <TabsContent value="git" className="min-h-0 flex-1 overflow-y-auto p-3">
          <GitPanel directory={directory} projectID={projectID} canonical={canonical} />
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1 overflow-hidden p-0">
          <PairTerminal
            sessionID={session?.id ?? ''}
            title={session?.title}
            directory={directory}
            messages={messages}
            status={snapshot.status}
          />
        </TabsContent>
      </Tabs>
      <SessionPlanDock
        session={session}
        messages={messages}
        draft={draft}
        busy={snapshot.status.type !== 'idle'}
      />
    </aside>
  )
}
