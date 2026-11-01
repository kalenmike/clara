import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { isStandalone } from '@/features/notifications/push'
import { applyUpdate, clearCachedAppData, usePwaUpdate } from '@/features/pwa/update-store'
import { claraBuildLabel, claraBuildTitle, claraVersion } from '@/lib/build-info'

/**
 * The escape hatch for a wedged PWA: clearing the caches and reloading repairs
 * a stale app without asking anyone to delete and re-add the home-screen icon.
 */
export function AppCard() {
  const { status } = usePwaUpdate()
  const applying = status === 'applying'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <RefreshCw className="size-4" /> App
        </CardTitle>
        <CardDescription>The installed Clara build, and a way out of a stale one.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <span className="text-muted-foreground">Version</span>
          <span className="max-w-[70%] truncate text-right font-mono text-xs">{claraVersion}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-muted-foreground">Build</span>
          <span
            className="max-w-[70%] truncate text-right font-mono text-xs"
            title={claraBuildTitle}
          >
            {claraBuildLabel}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-muted-foreground">Running as</span>
          <span className="max-w-[70%] truncate text-right text-xs">
            {isStandalone() ? 'installed app' : 'browser tab'}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="text-muted-foreground">Updates</span>
          <span className="max-w-[70%] truncate text-right text-xs">
            {status === 'available'
              ? 'a new version is ready'
              : status === 'applying'
                ? 'updating'
                : 'up to date'}
          </span>
        </div>
        {status === 'available' && (
          <Button size="sm" onClick={() => void applyUpdate()} disabled={applying}>
            {applying && <Loader2 className="size-4 animate-spin" />}
            {applying ? 'Updating…' : 'Update and reload'}
          </Button>
        )}
        <Separator />
        <p className="text-xs text-muted-foreground">
          Clearing cached files reloads Clara and downloads the current build. Pairing, settings,
          and drafts stay on this device; notifications may need to be turned on again.
        </p>
        <Button variant="outline" size="sm" onClick={() => void clearCachedAppData()}>
          <Trash2 className="size-4" /> Clear cached app data
        </Button>
      </CardContent>
    </Card>
  )
}
