import { useNavigate } from 'react-router'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useInboxSessions } from '@/features/sessions/use-inbox-sessions'
import { cn } from '@/lib/utils'

export function InboxJumpButton({
  projectID,
  currentSessionID,
  directory,
  className,
}: {
  projectID: string
  currentSessionID: string
  directory: string
  className?: string
}) {
  const navigate = useNavigate()
  const { top, pending, isError } = useInboxSessions(directory)
  const disabled = pending || isError || !top || top.id === currentSessionID
  const reason = pending
    ? 'Loading the Inbox…'
    : isError
      ? 'Could not load the Inbox'
      : !top
        ? 'No sessions in the Inbox'
        : top.id === currentSessionID
          ? 'You are already on the newest Inbox session'
          : `Open newest Inbox session: ${top.title || 'Untitled session'}`

  const jump = () => {
    if (!top || top.id === currentSessionID) return
    navigate(`/p/${projectID}/s/${top.id}`)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', className)}>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={jump}
            disabled={disabled}
            aria-label={reason}
            className="gap-2 rounded-full bg-background shadow-lg"
          >
            <Inbox className="size-4" />
            Inbox
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}
