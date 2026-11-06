import { Forward, GitFork, MoreHorizontal, TextSelect } from 'lucide-react'
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
  canFork,
  canForward,
  canSelect,
  selecting,
  onFork,
  onForward,
  onSelect,
}: {
  disabled?: boolean
  canFork: boolean
  canForward: boolean
  canSelect?: boolean
  selecting?: boolean
  onFork: () => void
  onForward: () => void
  onSelect?: () => void
}) {
  const { lowerSingular } = useSessionWording()
  const forwardDisabled = disabled || !canForward

  return (
    <>
      <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 md:flex">
        {canSelect ? (
          <Button
            type="button"
            variant={selecting ? 'secondary' : 'ghost'}
            size="icon"
            onClick={onSelect}
            disabled={disabled}
            title={selecting ? 'Stop selecting parts' : 'Select part of this reply'}
            aria-pressed={selecting}
            className="size-8"
          >
            <TextSelect className="size-3.5" />
            <span className="sr-only">
              {selecting ? 'Stop selecting parts' : 'Select part of this reply'}
            </span>
          </Button>
        ) : null}
        {canFork && (
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
        )}
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
            {canSelect ? (
              <DropdownMenuItem onSelect={onSelect} disabled={disabled}>
                <TextSelect className="size-3.5" />
                {selecting ? 'Stop selecting' : 'Select part'}
              </DropdownMenuItem>
            ) : null}
            {canFork && (
              <DropdownMenuItem onSelect={onFork} disabled={disabled}>
                <GitFork className="size-3.5" /> Fork from here
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onForward} disabled={forwardDisabled}>
              <Forward className="size-3.5" /> Forward to new {lowerSingular}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
