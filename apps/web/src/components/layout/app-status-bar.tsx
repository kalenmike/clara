import { cn } from '@/lib/utils'
import { claraBuildTitle, claraVersionLabel } from '@/lib/build-info'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'

/**
 * The app-wide status strip. It owns the bottom safe-area inset for the shell,
 * carries the live stream health on the left, and keeps the running surface and
 * version at the far right on every page.
 */
export function AppStatusBar() {
  const { reconnect, reconnecting } = useConnection()
  const { state } = useEventStream()

  return (
    <footer
      aria-label="Clara status"
      className="flex shrink-0 items-center border-t bg-background px-3 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-[10px] text-muted-foreground md:text-[11px]"
    >
      <span className="mr-auto flex min-w-0 items-center gap-1 uppercase tracking-wider">
        {state === 'live' ? (
          <>
            <span className="size-1.5 rounded-full bg-emerald-500" />
            live
          </>
        ) : (
          <button
            type="button"
            onClick={() => void reconnect()}
            disabled={reconnecting}
            title="Reconnect to the harness"
            className="flex items-center gap-1 rounded-sm uppercase tracking-wider transition-colors hover:text-foreground disabled:opacity-60"
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                reconnecting ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground/40'
              )}
            />
            {reconnecting || state === 'connecting' ? 'reconnecting' : 'retry'}
          </button>
        )}
      </span>
      <span className="min-w-0 truncate font-mono" title={claraBuildTitle}>
        {claraVersionLabel()}
      </span>
    </footer>
  )
}
