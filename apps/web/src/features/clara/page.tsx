import { useCallback, useEffect, useState } from 'react'
import { Bell, Loader2, RefreshCw } from 'lucide-react'
import { Navigate } from 'react-router'
import type { LedgerAlert, LedgerAlertKind } from '@clara/shared-types'
import { PageShell } from '@/components/layout/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/format'
import { useConnection } from '@/providers/connection-provider'

const KIND_LABELS: Record<LedgerAlertKind, string> = {
  decision: 'Decision',
  stalled: 'Stalled',
  budget: 'Budget',
  approval: 'Approval',
  gates: 'Human gates',
  kill: 'Stopped',
}

export function ClaraPage() {
  const { control, relayStatus, generation } = useConnection()
  const management = relayStatus?.agent?.management === true
  const clara = control?.clara
  const [alerts, setAlerts] = useState<LedgerAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(
    async (mode: 'load' | 'refresh' = 'load') => {
      if (!clara || !management) {
        setAlerts([])
        setLoading(false)
        setRefreshing(false)
        return
      }
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      setError(undefined)
      try {
        const result = await clara.requestLedgerInbox(`inbox-${Date.now()}`)
        if (result.type === 'inbox') setAlerts(result.inbox.items)
        else setError(result.message)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [clara, management]
  )

  useEffect(() => {
    void load()
  }, [load, generation])

  useEffect(() => {
    if (!clara) return
    return clara.subscribeLedgerAlert(() => {
      void load('refresh')
    })
  }, [clara, load])

  if (!management) {
    return <Navigate to="/" replace />
  }

  return (
    <PageShell
      title="Clara inbox"
      description={
        alerts.length > 0
          ? `${alerts.length} item${alerts.length === 1 ? '' : 's'} need your attention`
          : 'Exceptions that need a person from the Clara ledger.'
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load('refresh')}
          disabled={refreshing}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading Clara inbox…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium">Could not read the Clara inbox</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Bell className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Nothing needs you</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clara will add a card here when a decision, approval, gate, or stall needs a person.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Card key={alert.key}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={alert.kind === 'kill' ? 'destructive' : 'secondary'}>
                    {KIND_LABELS[alert.kind]}
                  </Badge>
                  <span className="text-sm font-medium">{alert.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(alert.createdAt).getTime())}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{alert.body}</p>
              </CardContent>
            </Card>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Resolve decisions, approvals, and gates in the Clara agent. The inbox is read-only.
          </p>
        </div>
      )}
    </PageShell>
  )
}
