import { useState } from 'react'
import type { PanelSnapshot } from '@clara/shared-types'
import { PairClientDialog } from '../pair-client-dialog.tsx'
import { ClientsTable } from '../clients-table.tsx'
import { DevicesCard } from '../devices-card.tsx'
import { View } from '../shell/view.tsx'

export function ClientsView({
  snapshot,
  now,
  onChanged,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
}) {
  const [pairingOpen, setPairingOpen] = useState(false)
  const clients = snapshot.clients.filter((client) => client.kind !== 'adapter')

  return (
    <View
      id="clients"
      kicker="Connections"
      title="Clients"
      description="Live end-to-end encrypted browser sessions and the devices that own them."
      actions={
        <button type="button" className="panel-button primary" onClick={() => setPairingOpen(true)}>
          Pair Client
        </button>
      }
    >
      <div className="space-y-3">
        <ClientsTable clients={clients} devices={snapshot.devices} now={now} />
        <DevicesCard devices={snapshot.devices} now={now} onChanged={onChanged} />
      </div>
      <PairClientDialog
        open={pairingOpen}
        snapshot={snapshot}
        now={now}
        onChanged={onChanged}
        onClose={() => setPairingOpen(false)}
      />
    </View>
  )
}
