import type { PanelSnapshot } from '@clara/shared-types'
import type { SetupPreferences, SetupState } from '../../lib/onboarding.ts'
import { AdapterRegistryCard } from '../adapter-registry-card.tsx'
import { ClientSyncCard } from '../client-sync-card.tsx'
import { OrchestrationCard } from '../orchestration-card.tsx'
import { AgentCard, ConfigCard } from '../overview-cards.tsx'
import { SetupCard } from '../setup-card.tsx'
import { View } from '../shell/view.tsx'
import { ThemeCard } from '../theme-card.tsx'

export function SettingsView({
  snapshot,
  now,
  onChanged,
  setup,
  preferences,
  onOpenSetup,
  onOpenReconfigure,
  onOpenGuide,
}: {
  snapshot: PanelSnapshot
  now: number
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
      description="Panel appearance, hub details, orchestration, adapter downloads, effective configuration, client sync, and setup."
    >
      <ThemeCard />
      <div className="grid items-start gap-3 md:grid-cols-2">
        <AgentCard
          agent={snapshot.agent}
          controls={snapshot.controls}
          onChanged={onChanged}
          now={now}
        />
        <OrchestrationCard
          orchestration={snapshot.controls.orchestration}
          onChanged={onChanged}
          defaultExpanded
        />
      </div>
      <div className="grid items-start gap-3 md:grid-cols-2">
        <ConfigCard config={snapshot.config} onChanged={onChanged} />
        <AdapterRegistryCard
          config={snapshot.config}
          controls={snapshot.controls}
          onChanged={onChanged}
        />
      </div>
      <div className="grid items-start gap-3 md:grid-cols-2">
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
