import type { PanelSnapshot } from '@clara/shared-types'
import { findFeature } from '../../lib/feature-control.ts'
import { harnessHealth, type HealthTone } from '../../lib/health.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { HarnessAddCard } from '../harness-add-card.tsx'
import { HarnessConnectionsCard } from '../harness-connections-card.tsx'
import { HarnessSessionsCard } from '../harness-sessions-card.tsx'
import { Badge, Notice, type Tone } from '../primitives.tsx'
import { View } from '../shell/view.tsx'

const HEALTH_TONE: Record<HealthTone, Tone> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  idle: 'neutral',
}

export function HarnessView({
  snapshot,
  now,
  onChanged,
}: {
  snapshot: PanelSnapshot
  now: number
  onChanged: () => void
}) {
  const { redact } = usePeek()
  const feature = findFeature(snapshot.controls, 'opencode')
  const activeHarness = snapshot.harnesses.find((harness) => harness.isActive)
  const health = harnessHealth(snapshot.opencode, activeHarness?.label)
  const adapterClients = snapshot.clients.filter((client) => client.kind === 'adapter')
  const notice =
    snapshot.harness.error ??
    (snapshot.opencode.code !== 'disabled' && snapshot.opencode.code !== 'unconfigured'
      ? snapshot.opencode.error
      : undefined)

  return (
    <View
      id="harness"
      kicker={activeHarness?.label ?? 'Harness'}
      title="Harness"
      description="Live adapter sessions, paired harnesses, and the harness server this hub proxies."
      actions={<Badge tone={HEALTH_TONE[health.tone]}>{health.status}</Badge>}
    >
      {notice ? (
        <div className="mb-3">
          <Notice tone="danger">{redact(notice)}</Notice>
        </div>
      ) : null}
      <div className="space-y-3">
        <HarnessAddCard
          enabled={feature.desired}
          relayConfigured={snapshot.relay.configured}
          harnesses={snapshot.harnesses}
          onChanged={onChanged}
          now={now}
          initialTransport={snapshot.agent.container ? 'docker' : 'local'}
        />
        <HarnessSessionsCard clients={adapterClients} harnesses={snapshot.harnesses} now={now} />
        <HarnessConnectionsCard
          harnesses={snapshot.harnesses}
          enabled={feature.desired}
          onChanged={onChanged}
          now={now}
        />
      </div>
    </View>
  )
}
