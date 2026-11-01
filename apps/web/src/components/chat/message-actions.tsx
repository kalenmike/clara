import { Forward, GitFork, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSessionWording } from '@/features/sessions/use-wording'

export function MessageActions({
  disabled,
  canForward,
  onFork,
  onForward,
}: {
  disabled?: boolean
  canForward: boolean
  onFork: () => void
  onForward: () => void
}) {
  const { lowerSingular } = useSessionWording()
  const forwardDisabled = disabled || !canForward

  return (
    <>
      <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 md:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onFork}
          disabled={disabled}
          title="Fork from this message"
          className="size-8"
        >
          <GitFork className="size-3.5" />
          <span className="sr-only">Fork from this message</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onForward}
          disabled={forwardDisabled}
          title={`Forward this message to a new ${lowerSingular}`}
          className="size-8"
        >
          <Forward className="size-3.5" />
          <span className="sr-only">Forward this message to a new {lowerSingular}</span>
        </Button>
      </div>

      <div className="shrink-0 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Message actions"
            >
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onFork} disabled={disabled}>
              <GitFork className="size-3.5" /> Fork from here
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onForward} disabled={forwardDisabled}>
              <Forward className="size-3.5" /> Forward to new {lowerSingular}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
