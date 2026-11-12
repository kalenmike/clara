import type { PanelSnapshot } from '@clara/shared-types'
import { HarnessCard } from '../harness-card.tsx'
import { OpenCodeCard } from '../overview-cards.tsx'
import { View } from '../shell/view.tsx'

export function HarnessView({
  snapshot,
  now,
  onChanged,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
}) {
  return (
    <View
      id="harness"
      kicker="OpenCode"
      title="Harness"
      description="The OpenCode server this hub proxies to every paired client."
    >
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <HarnessCard
          harness={snapshot.harness}
          harnesses={snapshot.harnesses}
          enabled={
            snapshot.controls.features.find((feature) => feature.name === 'opencode')?.desired ??
            true
          }
          relayConfigured={snapshot.relay.configured}
          onChanged={onChanged}
          now={now}
        />
        <OpenCodeCard
          opencode={snapshot.opencode}
          controls={snapshot.controls}
          onChanged={onChanged}
          now={now}
          defaultExpanded
        />
      </div>
    </View>
  )
}
