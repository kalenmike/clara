import { Eye, EyeOff, LogOut, RefreshCw } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { usePeek } from '../../lib/peek-context.tsx'

export function TitleBar({
  refreshing,
  onRefresh,
  onLogout,
}: {
  refreshing: boolean
  onRefresh: () => void
  onLogout: () => void
}) {
  const { masked, toggle } = usePeek()

  return (
    <header className="panel-titlebar">
      <div className="panel-titlebar-brand">
        <span className="panel-titlebar-mark" aria-hidden="true">
          C
        </span>
        <strong>Clara hub panel</strong>
        <span className="panel-titlebar-tag">hub</span>
      </div>

      <div className="panel-titlebar-actions">
        <Button
          type="button"
          role="switch"
          aria-checked={masked}
          aria-label="Hide sensitive data"
          title={masked ? 'Reveal sensitive data' : 'Hide sensitive data'}
          onClick={toggle}
          variant="outline"
          size="icon"
        >
          {masked ? (
            <Eye className="size-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="size-3.5" aria-hidden="true" />
          )}
        </Button>
        <Button
          type="button"
          aria-label="Refresh the hub snapshot"
          title="Refresh the hub snapshot"
          onClick={onRefresh}
          disabled={refreshing}
          variant="outline"
          size="icon"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </Button>
        <Button type="button" variant="outline" onClick={onLogout}>
          <LogOut className="size-3.5" aria-hidden="true" />
          <span className="panel-button-label">Sign out</span>
        </Button>
      </div>
    </header>
  )
}
