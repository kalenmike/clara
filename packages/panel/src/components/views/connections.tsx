import type { PanelSnapshot } from '@clara/shared-types'
import { LocalCard, PushCard, RelayCard } from '../overview-cards.tsx'
import { View } from '../shell/view.tsx'

export function ConnectionsView({
  snapshot,
  now,
  onChanged,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
}) {
  const localSessions = snapshot.clients.filter(
    (client) => client.transport === 'local' && client.kind === 'device'
  ).length

  return (
    <View
      id="connections"
      kicker="Transports"
      title="Connections"
      description="Loopback, relay, and push delivery. Each switch saves immediately."
    >
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        <LocalCard
          local={snapshot.local}
          config={snapshot.config}
          sessions={localSessions}
          controls={snapshot.controls}
          onChanged={onChanged}
          defaultExpanded
        />
        <RelayCard
          relay={snapshot.relay}
          controls={snapshot.controls}
          onChanged={onChanged}
          now={now}
          defaultExpanded
        />
        <PushCard
          push={snapshot.push}
          controls={snapshot.controls}
          onChanged={onChanged}
          defaultExpanded
        />
      </div>
    </View>
  )
}
