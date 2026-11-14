import type { PanelSnapshot } from '@clara/shared-types'
import { ClientSyncCard } from '../client-sync-card.tsx'
import { ConfigCard } from '../overview-cards.tsx'
import { View } from '../shell/view.tsx'
import { ThemeCard } from '../theme-card.tsx'

export function SettingsView({
  snapshot,
  onChanged,
}: {
  snapshot: PanelSnapshot
  onChanged: () => void
}) {
  return (
    <View
      id="settings"
      kicker="Control"
      title="Settings"
      description="Panel appearance, effective configuration, and client sync."
    >
      <ThemeCard />
      <div className="grid items-start gap-3 md:grid-cols-2">
        <ConfigCard config={snapshot.config} onChanged={onChanged} />
        <ClientSyncCard sync={snapshot.controls.sync} onChanged={onChanged} defaultExpanded />
      </div>
    </View>
  )
}
