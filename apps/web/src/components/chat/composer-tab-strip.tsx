import { useNavigate } from 'react-router'
import {
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  X,
} from 'lucide-react'
import { SessionStatusIcon } from '@/components/sessions/session-status-icon'
import { Button } from '@clara/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@clara/ui/components/tooltip'
import { useComposerTabStatus } from '@/features/chat/use-composer-tab-status'
import type { ComposerMode } from '@/features/chat/composer-session'
import { composerReturnPath, composerSessionTitle } from '@/features/chat/composer-session'
import type { ComposerTab } from '@/features/chat/composer-tabs'
import { useSessionForms } from '@/features/chat/use-forms'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useSession } from '@/features/sessions/use-sessions'
import { cn } from '@clara/ui/lib/utils'

export function ComposerTabStrip({
  tabs,
  mode,
  autoHide,
  pinned,
  currentSessionID,
  selectedSessionID,
  selectedPlanReady,
  onSelect,
  onClose,
  onToggleExpand,
  onToggleCollapse,
  onTogglePin,
}: {
  tabs: readonly ComposerTab[]
  mode: ComposerMode
  /** Auto-hide replaces the collapse chevron with a pin toggle. */
  autoHide: boolean
  pinned: boolean
  currentSessionID: string | undefined
  selectedSessionID: string | null
  /** The selected tab's live plan-ready state, counted beside its forms. */
  selectedPlanReady: boolean
  onSelect: (sessionID: string) => void
  onClose: (sessionID: string) => void
  onToggleExpand: () => void
  onToggleCollapse: () => void
  onTogglePin: () => void
}) {
  const fullscreen = mode === 'maximized'
  const minimized = mode === 'minimized'

  return (
    <div className="flex shrink-0 items-stretch border-b bg-popover text-popover-foreground">
      <div
        role="tablist"
        aria-label="Open composer sessions"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <ComposerTabButton
            key={tab.sessionID}
            tab={tab}
            current={tab.sessionID === currentSessionID}
            selected={tab.sessionID === selectedSessionID}
            planReady={tab.sessionID === selectedSessionID && selectedPlanReady}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 border-l px-1.5 py-1">
        {autoHide ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn('max-md:size-11', pinned && 'bg-accent text-accent-foreground')}
                onClick={onTogglePin}
                aria-pressed={pinned}
                aria-label={pinned ? 'Let the composer auto-hide' : 'Keep the composer open'}
              >
                {pinned ? (
                  <Pin className="size-3.5 max-md:size-5" />
                ) : (
                  <PinOff className="size-3.5 max-md:size-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{pinned ? 'Auto-hide' : 'Pin open'}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="max-md:size-11"
                onClick={onToggleCollapse}
                aria-label={minimized ? 'Restore the composer' : 'Collapse the composer'}
              >
                {minimized ? (
                  <ChevronUp className="size-3.5 max-md:size-5" />
                ) : (
                  <ChevronDown className="size-3.5 max-md:size-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{minimized ? 'Restore' : 'Collapse'}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="max-md:size-11"
              onClick={onToggleExpand}
              aria-label={fullscreen ? 'Dock the composer' : 'Expand composer'}
            >
              {fullscreen ? (
                <Minimize2 className="size-3.5 max-md:size-5" />
              ) : (
                <Maximize2 className="size-3.5 max-md:size-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fullscreen ? 'Return to the dock' : 'Expand'}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function ComposerTabButton({
  tab,
  current,
  selected,
  planReady,
  onSelect,
  onClose,
}: {
  tab: ComposerTab
  current: boolean
  selected: boolean
  planReady: boolean
  onSelect: (sessionID: string) => void
  onClose: (sessionID: string) => void
}) {
  const navigate = useNavigate()
  const { lowerSingular } = useSessionWording()
  const session = useSession(tab.sessionID).data
  const status = useComposerTabStatus(session)
  const formsQuery = useSessionForms(tab.sessionID)
  const forms = formsQuery.data ?? []
  const requestCount = forms.length + (planReady ? 1 : 0)
  const title = composerSessionTitle(session?.title, lowerSingular)
  const returnPath = composerReturnPath(tab)

  return (
    <div
      className={cn(
        'group flex min-w-0 max-w-56 shrink-0 items-center rounded-md border transition-colors',
        current
          ? 'border-border bg-accent text-accent-foreground'
          : selected
            ? 'border-primary/40 bg-accent/50'
            : 'border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground'
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => onSelect(tab.sessionID)}
        title={title}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SessionStatusIcon status={status} />
        <span className="min-w-0 truncate text-xs font-medium">{title}</span>
        {requestCount > 0 && (
          <span
            className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-semibold text-white"
            title={requestCount === 1 ? '1 request waiting' : `${requestCount} requests waiting`}
          >
            {requestCount > 9 ? '9+' : requestCount}
          </span>
        )}
      </button>

      {!current && (
        <>
          {returnPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate(returnPath)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:p-2"
                  aria-label={`Go to ${title}`}
                >
                  <CornerUpLeft className="size-3 max-md:size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Go to {title}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onClose(tab.sessionID)}
                className="mr-0.5 shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:p-2"
                aria-label={`Close ${title}`}
              >
                <X className="size-3 max-md:size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Close {title}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}
