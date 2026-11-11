import type { PanelSnapshot } from '@clara/shared-types'
import { ClientSyncCard } from '../client-sync-card.tsx'
import { ConfigCard } from '../overview-cards.tsx'
import { ShellPolicyCard } from '../shell-policy-card.tsx'
import { View } from '../shell/view.tsx'

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
      description="Effective configuration, client sync, and the shell guardrail."
    >
      <div className="grid items-start gap-3 md:grid-cols-2">
        <ConfigCard config={snapshot.config} onChanged={onChanged} />
        <ClientSyncCard sync={snapshot.controls.sync} onChanged={onChanged} defaultExpanded />
      </div>
      <ShellPolicyCard
        shell={snapshot.controls.shell}
        onChanged={onChanged}
        defaultExpanded={snapshot.controls.shell.mode === 'allowlist'}
      />
    </View>
  )
}
