import { useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConnection } from '@/providers/connection-provider'

/**
 * The hub tunnel can be healthy while the harness adapter is missing or
 * offline. Keep the app usable and surface that as a retryable banner instead
 * of failing the connection screen.
 */
export function HarnessBanner() {
  const { status, harness, harnessError, refreshHarness } = useConnection()
  const [retrying, setRetrying] = useState(false)

  if (status !== 'connected' || harness || !harnessError) return null

  const retry = async () => {
    setRetrying(true)
    try {
      await refreshHarness()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">Harness unavailable.</span>{' '}
        <span className="text-amber-800/80 dark:text-amber-100/80">{harnessError}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7"
        onClick={() => void retry()}
        disabled={retrying}
      >
        {retrying ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Retry
      </Button>
    </div>
  )
}
