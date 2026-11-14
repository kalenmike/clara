import { useState } from 'react'
import { Cloud, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { SYNC_CATEGORIES, SYNC_CATEGORY_INFO, type SyncCategory } from '@/features/sync/categories'
import {
  SYNC_STANDALONE,
  SYNC_STANDALONE_INFO,
  type SyncStandalone,
} from '@/features/sync/standalone'
import { useSettingsSync } from '@/providers/settings-sync-provider'

type PendingChoice =
  { kind: 'category'; id: SyncCategory } | { kind: 'standalone'; id: SyncStandalone } | null

export function SyncCard() {
  const {
    available,
    enabled,
    standaloneEnabled,
    intervalMs,
    reason,
    status,
    syncNow,
    toggle,
    toggleStandalone,
  } = useSettingsSync()
  const [pending, setPending] = useState<PendingChoice>(null)
  const hasEnabled =
    SYNC_CATEGORIES.some((category) => enabled[category]) ||
    SYNC_STANDALONE.some((standalone) => standaloneEnabled[standalone])

  const chooseCategory = async (category: SyncCategory) => {
    setPending({ kind: 'category', id: category })
    try {
      await toggle(category)
    } finally {
      setPending(null)
    }
  }

  const chooseStandalone = async (standalone: SyncStandalone) => {
    setPending({ kind: 'standalone', id: standalone })
    try {
      await toggleStandalone(standalone)
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cloud className="size-4" /> Settings sync
        </CardTitle>
        <CardDescription>
          Choose what this device shares with your other paired devices. The hub stores the values,
          and its copy wins when devices disagree.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reason && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
            {reason}
          </p>
        )}

        <div className="space-y-1 rounded-lg border p-2">
          {SYNC_CATEGORY_INFO.map((info) => {
            const checked = enabled[info.id]
            return (
              <div key={info.id} className="flex items-start gap-3 rounded-md px-1 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{info.label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{info.description}</p>
                </div>
                <Switch
                  checked={checked}
                  onCheckedChange={() => void chooseCategory(info.id)}
                  disabled={pending !== null || (!available && !checked)}
                  aria-label={`Sync ${info.label}`}
                />
              </div>
            )
          })}
        </div>

        <div className="space-y-1 rounded-lg border border-dashed p-2">
          <div className="px-1 py-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Single setting
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared on its own, outside the groups above.
            </p>
          </div>
          {SYNC_STANDALONE_INFO.map((info) => {
            const checked = standaloneEnabled[info.id]
            return (
              <div key={info.id} className="flex items-start gap-3 rounded-md px-1 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{info.label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{info.description}</p>
                </div>
                <Switch
                  checked={checked}
                  onCheckedChange={() => void chooseStandalone(info.id)}
                  disabled={pending !== null || (!available && !checked)}
                  aria-label={`Sync ${info.label} on its own`}
                />
              </div>
            )
          })}
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              {status.syncing && <Loader2 className="size-3.5 animate-spin" />}
              <span>{statusText(status.syncing, status.lastSyncedAt)}</span>
            </div>
            <p className="mt-0.5">
              Checks every {intervalLabel(intervalMs)}. The cadence is set in the hub panel.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void syncNow()}
            disabled={!available || status.syncing || !hasEnabled}
          >
            {status.syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sync now
          </Button>
        </div>

        {status.error && <p className="text-xs text-destructive">{status.error}</p>}

        <p className="text-[11px] text-muted-foreground">
          Each device chooses its own categories and single-setting shares. Turning one off stops
          syncing it here but leaves the value the hub already stored.
        </p>
      </CardContent>
    </Card>
  )
}

function statusText(syncing: boolean, lastSyncedAt: number | null): string {
  if (syncing) return 'Syncing…'
  if (lastSyncedAt === null) return 'Not synced yet'
  const seconds = Math.max(0, Math.round((Date.now() - lastSyncedAt) / 1_000))
  if (seconds < 10) return 'Synced just now'
  if (seconds < 60) return `Synced ${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Synced ${minutes}m ago`
  return `Synced ${Math.round(minutes / 60)}h ago`
}

function intervalLabel(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1_000)} seconds`
  const minutes = Math.round(ms / 60_000)
  return minutes === 1 ? 'minute' : `${minutes} minutes`
}
