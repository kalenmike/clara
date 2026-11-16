import type { PanelSnapshot } from '@clara/shared-types'
import { usePanelCapabilities } from '../../lib/capabilities-context.ts'
import type { SetupPreferences, SetupState } from '../../lib/onboarding.ts'
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
  const { allowThemeSwitch } = usePanelCapabilities()

  return (
    <View
      id="settings"
      kicker="Control"
      title="Settings"
      description={
        allowThemeSwitch
          ? 'Panel appearance, hub details, effective configuration, and setup.'
          : 'Hub details, effective configuration, and setup.'
      }
    >
      {allowThemeSwitch ? <ThemeCard /> : null}
      <div className="grid items-start gap-3 md:grid-cols-2">
        <AgentCard
          agent={snapshot.agent}
          controls={snapshot.controls}
          onChanged={onChanged}
          now={now}
        />
        <ConfigCard config={snapshot.config} onChanged={onChanged} />
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
