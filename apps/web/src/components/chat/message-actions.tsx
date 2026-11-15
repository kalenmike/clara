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
      {/*
        The rail floats over the message rather than taking a column, so the
        reply keeps its full width. It is sticky inside a box that spans this
        message only: the controls stay just below the page header while the
        message scrolls, then travel out with its bottom edge.
      */}
      <div className="pointer-events-none absolute inset-y-0 right-2 z-10 hidden w-8 md:block sm:right-4">
        <div className="sticky top-2 flex flex-col items-center gap-px rounded-lg bg-background/95 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
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
      </div>

      <div className="absolute top-1 right-2 z-10 md:hidden sm:right-4">
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
