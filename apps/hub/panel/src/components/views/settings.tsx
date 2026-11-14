import type { PanelSnapshot } from '@clara/shared-types'
import type { SetupPreferences, SetupState } from '../../lib/onboarding.ts'
import { ClientSyncCard } from '../client-sync-card.tsx'
import { ConfigCard } from '../overview-cards.tsx'
import { SetupCard } from '../setup-card.tsx'
import { View } from '../shell/view.tsx'
import { ThemeCard } from '../theme-card.tsx'

export function SettingsView({
  snapshot,
  onChanged,
  setup,
  preferences,
  onOpenSetup,
  onOpenReconfigure,
  onOpenGuide,
}: {
  snapshot: PanelSnapshot
  onChanged: () => void
  setup: SetupState
  preferences: SetupPreferences
  onOpenSetup: () => void
  onOpenReconfigure: () => void
  onOpenGuide: () => void
}) {
  return (
    <View
      id="settings"
      kicker="Control"
      title="Settings"
      description="Panel appearance, effective configuration, client sync, and setup."
    >
      <ThemeCard />
      <div className="grid items-start gap-3 md:grid-cols-2">
        <ConfigCard config={snapshot.config} onChanged={onChanged} />
        <ClientSyncCard sync={snapshot.controls.sync} onChanged={onChanged} defaultExpanded />
      </div>
      <SetupCard
        setup={setup}
        preferences={preferences}
        onOpenSetup={onOpenSetup}
        onOpenReconfigure={onOpenReconfigure}
        onOpenGuide={onOpenGuide}
      />
    </View>
  )
}
