import { useEffect, useState } from 'react'
import type { PanelSnapshot } from '@clara/shared-types'
import { findFeature } from '../../lib/feature-control.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { HarnessConnectionsCard } from '../harness-connections-card.tsx'
import { HarnessPairDialog } from '../harness-pair-dialog.tsx'
import { HarnessSessionsCard } from '../harness-sessions-card.tsx'
import { HostResourcesCard } from '../host-resources-card.tsx'
import { Notice } from '../primitives.tsx'
import { View } from '../shell/view.tsx'

export function HarnessView({
  snapshot,
  now,
  onChanged,
  initialPairingCode,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
  initialPairingCode?: string
}) {
  const { redact } = usePeek()
  const [pairingOpen, setPairingOpen] = useState(Boolean(initialPairingCode))
  const [pairingCode, setPairingCode] = useState(initialPairingCode)
  const feature = findFeature(snapshot.controls, 'opencode')
  const adapterClients = snapshot.clients.filter((client) => client.kind === 'adapter')
  const notice = snapshot.harness.error

  useEffect(() => {
    if (!initialPairingCode) return
    setPairingCode(initialPairingCode)
    setPairingOpen(true)
  }, [initialPairingCode])

  return (
    <View
      id="harness"
      kicker={`${snapshot.harness.online} of ${snapshot.harness.paired} online`}
      title="Harness"
      description="Every paired harness is a peer. Workspaces choose the harness they belong to."
      actions={
        <button type="button" className="panel-button primary" onClick={() => setPairingOpen(true)}>
          Pair Harness
        </button>
      }
    >
      {notice ? (
        <div className="mb-3">
          <Notice tone="danger">{redact(notice)}</Notice>
        </div>
      ) : null}
      <div className="space-y-3">
        <HarnessSessionsCard clients={adapterClients} harnesses={snapshot.harnesses} now={now} />
        <HostResourcesCard harnesses={snapshot.harnesses} now={now} />
        <HarnessConnectionsCard
          harnesses={snapshot.harnesses}
          enabled={feature.desired}
          onChanged={onChanged}
          now={now}
        />
      </div>
      <HarnessPairDialog
        open={pairingOpen}
        snapshot={snapshot}
        now={now}
        onChanged={onChanged}
        onClose={() => {
          setPairingOpen(false)
          setPairingCode(undefined)
        }}
        {...(pairingCode ? { initialCode: pairingCode } : {})}
      />
    </View>
  )
}
