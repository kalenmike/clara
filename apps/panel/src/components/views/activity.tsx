import type { PanelSnapshot } from '@clara/shared-types'
import { storageHealth, type HealthTone } from '../../lib/health.ts'
import { EventsCard } from '../events-list.tsx'
import { Badge, type Tone } from '../primitives.tsx'
import { StorageCard } from '../storage-list.tsx'
import { View } from '../shell/view.tsx'

const STORAGE_SUMMARY_TONE: Record<HealthTone, Tone> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  idle: 'neutral',
}

export function ActivityView({ snapshot, now }: { snapshot: PanelSnapshot; now: number }) {
  const storage = storageHealth(snapshot.storage)
  const warnings = snapshot.events.filter((event) => event.level !== 'info').length

  return (
    <View
      id="activity"
      kicker="Log"
      title="Activity"
      description="In-memory events and the files the agent reads or writes."
      actions={
        <>
          <Badge tone="neutral">{snapshot.events.length} events</Badge>
          {warnings > 0 ? <Badge tone="warning">{warnings} warning</Badge> : null}
          <Badge tone={STORAGE_SUMMARY_TONE[storage.tone]}>Storage · {storage.label}</Badge>
        </>
      }
    >
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <EventsCard events={snapshot.events} now={now} />
        <StorageCard storage={snapshot.storage} now={now} defaultExpanded />
      </div>
    </View>
  )
}
