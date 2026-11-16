import type { PanelSnapshot } from '@clara/shared-types'
import { TrafficCard } from '../traffic-card.tsx'
import { View } from '../shell/view.tsx'

export function TrafficView({
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
      id="traffic"
      kicker="Meter"
      title="Traffic"
      description="Bytes, requests, and errors through the hub over the last hour."
    >
      <div className="w-full">
        <TrafficCard
          traffic={snapshot.traffic}
          monitoring={snapshot.controls.monitoring}
          onChanged={onChanged}
          now={now}
          defaultExpanded={snapshot.controls.monitoring.enabled}
        />
      </div>
    </View>
  )
}
