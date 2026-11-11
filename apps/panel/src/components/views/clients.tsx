import type { PanelSnapshot } from '@clara/shared-types'
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
  const pairing = snapshot.clients.filter((client) => client.kind === 'enroll').length
  const active = snapshot.clients.length - pairing

  return (
    <View
      id="clients"
      kicker="Sessions"
      title="Clients"
      description="Live end-to-end encrypted sessions and the devices that own them."
      actions={
        <>
          <Badge tone={active > 0 ? 'info' : 'neutral'}>{active} active</Badge>
          {pairing > 0 ? <Badge tone="warning">{pairing} pairing</Badge> : null}
        </>
      }
    >
      <div className="space-y-3">
        <ClientsTable clients={snapshot.clients} devices={snapshot.devices} now={now} />
        <DevicesCard devices={snapshot.devices} now={now} onChanged={onChanged} />
      </div>
    </View>
  )
}
