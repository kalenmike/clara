import type { PanelSnapshot } from '@clara/shared-types'
import { AdapterRegistryCard } from '../adapter-registry-card.tsx'
import { ClientSyncCard } from '../client-sync-card.tsx'
import { OrchestrationCard } from '../orchestration-card.tsx'
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
      description="Loopback, relay, push, orchestration, client sync, and adapters. Each switch saves immediately."
    >
      <div className="grid items-start gap-3 md:grid-cols-2">
        <LocalCard
          local={snapshot.local}
          config={snapshot.config}
          sessions={localSessions}
          controls={snapshot.controls}
          onChanged={onChanged}
        />
        <RelayCard
          relay={snapshot.relay}
          controls={snapshot.controls}
          onChanged={onChanged}
          now={now}
        />
        <PushCard push={snapshot.push} controls={snapshot.controls} onChanged={onChanged} />
        <ClientSyncCard sync={snapshot.controls.sync} onChanged={onChanged} />
        <OrchestrationCard orchestration={snapshot.controls.orchestration} onChanged={onChanged} />
        <AdapterRegistryCard
          config={snapshot.config}
          controls={snapshot.controls}
          onChanged={onChanged}
        />
      </div>
    </View>
  )
}
