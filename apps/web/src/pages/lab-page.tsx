import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router'
import { LabApp, configureLabApi } from '@clara/lab'
import '@clara/lab/styles.css'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { Button } from '@/components/ui/button'
import { labAvailable, readLabHealth } from '@/lib/desktop-lab'
import { useConnection } from '@/providers/connection-provider'

/**
 * Clara Lab at `/lab`. The UI is compiled only into the desktop build. Its
 * server runs next to the engine and is reached through the hub bridge under
 * `/v1/lab`, so the desktop works even when the hub and engine are remote.
 */
export function LabPage() {
  const { status, booting, control } = useConnection()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    if (!labAvailable()) {
      setError('Clara Lab is available in Clara Desktop only.')
      return
    }
    if (!control) return

    configureLabApi({ fetch: control.fetch, basePath: '/v1/lab' })
    void readLabHealth(control)
      .then(() => {
        if (alive) setReady(true)
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(
            cause instanceof Error
              ? `The lab server is not available through the hub: ${cause.message}`
              : `The lab server is not available through the hub: ${String(cause)}`
          )
        }
      })

    return () => {
      alive = false
      configureLabApi(null)
    }
  }, [control])

  if (booting) return <ConnectionSplash label="Checking connection…" />
  if (status === 'connecting') return <ConnectionSplash label="Connecting to the hub…" />
  if (status !== 'connected' || !control) {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Clara
          </Link>
        </Button>
        <span className="truncate text-xs text-muted-foreground">Clara Lab</span>
      </header>
      <div className="lab-root flex-1" data-embedded data-clara-lab-surface>
        {!ready && !error ? (
          <ConnectionSplash label="Opening Clara Lab…" />
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md space-y-2 text-center">
              <p className="text-sm font-medium">Clara Lab is unavailable</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : (
          <LabApp />
        )}
      </div>
    </div>
  )
}
