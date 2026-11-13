import type { PanelSnapshot } from '@clara/shared-types'
import { findFeature } from '../../lib/feature-control.ts'
import { BrowserPairCard } from '../browser-pair-card.tsx'
import { ClientsTable } from '../clients-table.tsx'
import { DevicesCard } from '../devices-card.tsx'
import { Badge } from '../primitives.tsx'
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
  const clients = snapshot.clients.filter((client) => client.kind !== 'adapter')
  const pairing = clients.filter((client) => client.kind === 'enroll').length
  const active = clients.length - pairing
  const local = findFeature(snapshot.controls, 'local')
  const relay = findFeature(snapshot.controls, 'relay')
  const canPair = !snapshot.controls.stopped && (local.effective || relay.effective)

  return (
    <View
      id="clients"
      kicker="Sessions"
      title="Clients"
      description="Live end-to-end encrypted browser sessions and the devices that own them."
      actions={
        <>
          <Badge tone={active > 0 ? 'info' : 'neutral'}>{active} active</Badge>
          {pairing > 0 ? <Badge tone="warning">{pairing} pairing</Badge> : null}
        </>
      }
    >
      <div className="space-y-3">
        <BrowserPairCard
          relayConfigured={snapshot.relay.configured}
          localAvailable={local.effective}
          canPair={canPair}
          now={now}
          onChanged={onChanged}
        />
        <ClientsTable clients={clients} devices={snapshot.devices} now={now} />
        <DevicesCard devices={snapshot.devices} now={now} onChanged={onChanged} />
      </div>
    </View>
  )
}
