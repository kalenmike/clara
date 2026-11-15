import { useState } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { Button } from '@clara/ui/components/button'
import { reloadApp } from '@/features/updates/app-update'
import { claraBuildTitle, claraVersionLabel } from '@/lib/build-info'
import { isDesktop } from '@/lib/runtime'

/**
 * The build stamp and the one way out of a stale app before pairing.
 *
 * The update banner lives inside the app shell, which an unpaired client never
 * reaches; its recovery action lives in Settings, which needs a pairing too. So
 * the pairing screen and every boot splash carry this footer instead. The web
 * app resets its worker and caches, which is the only path that also beats a
 * cached shell; the desktop shell reloads the assets it shipped with.
 *
 * The protocol version sits beside the build: a pairing code is rejected when
 * its wire version differs, so this is the first number to compare.
 */
export function AppFooter() {
  const [refreshing, setRefreshing] = useState(false)
  const label = isDesktop ? 'Reload Clara' : 'Reload and update Clara'

  const reload = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await reloadApp()
    } catch {
      // The reload is the last step; a failure before it leaves the control usable.
      setRefreshing(false)
    }
  }

  return (
    <footer className="flex shrink-0 items-center justify-center gap-1.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-muted-foreground">
      <span title={claraBuildTitle}>{claraVersionLabel()}</span>
      <span aria-hidden="true" className="text-muted-foreground/60">
        ·
      </span>
      <span title="Clara wire protocol">protocol v{PROTOCOL_VERSION}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground max-md:size-11"
        onClick={() => void reload()}
        disabled={refreshing}
        aria-label={label}
        title={label}
      >
        {refreshing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RotateCw className="size-3.5" />
        )}
      </Button>
    </footer>
  )
}
