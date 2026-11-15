import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { applyAppUpdate, dismissAppUpdate, useAppUpdate } from '@/features/updates/app-update'

/**
 * Sits in the flow under the app header. An installed app can resume for days
 * without a navigation, so the update is offered instead of forced: a reload
 * would drop an open chat.
 */
export function UpdateBanner() {
  const { status, dismissed } = useAppUpdate()
  if (status === 'idle' || dismissed) return null

  const applying = status === 'applying'

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/60 px-3 py-2 text-sm"
    >
      <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">
        A new version of Clara is ready.
        <span className="block text-xs text-muted-foreground">
          Update now, or keep working and it installs the next time Clara starts.
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-11 px-4 md:h-8"
          onClick={() => void applyAppUpdate()}
          disabled={applying}
        >
          {applying && <Loader2 className="size-4 animate-spin" />}
          {applying ? 'Updating…' : 'Update'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 px-4 md:h-8"
          onClick={dismissAppUpdate}
          disabled={applying}
        >
          Later
        </Button>
      </div>
    </div>
  )
}
