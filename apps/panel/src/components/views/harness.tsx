import type { PanelSnapshot } from '@clara/shared-types'
import { findFeature, useFeatureControl } from '../../lib/feature-control.ts'
import { harnessHealth, type HealthTone } from '../../lib/health.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { HarnessAddCard } from '../harness-add-card.tsx'
import { HarnessConnectionsCard } from '../harness-connections-card.tsx'
import { HarnessSessionsCard } from '../harness-sessions-card.tsx'
import { Badge, Notice, Toggle, type Tone } from '../primitives.tsx'
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
  const control = useFeatureControl(feature, snapshot.controls.stopped, onChanged)
  const health = harnessHealth(snapshot.opencode)
  const adapterClients = snapshot.clients.filter((client) => client.kind === 'adapter')
  const notice =
    control.error ??
    snapshot.harness.error ??
    (snapshot.opencode.code !== 'disabled' && snapshot.opencode.code !== 'unconfigured'
      ? snapshot.opencode.error
      : undefined)

  return (
    <View
      id="harness"
      kicker="OpenCode"
      title="Harness"
      description="Live adapter sessions, paired harnesses, and the OpenCode server this hub proxies."
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={HEALTH_TONE[health.tone]}>{health.status}</Badge>
          <span className="panel-muted max-w-64 truncate text-[11px]" title={redact(health.detail)}>
            {redact(health.detail)}
          </span>
          <Toggle
            checked={feature.desired}
            onChange={control.toggle}
            label={`Harness connection: ${feature.desired ? 'on' : 'off'}`}
            state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
            disabled={control.disabled}
            stopped={snapshot.controls.stopped}
            title={control.title}
          />
        </div>
      }
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
          onChanged={onChanged}
          now={now}
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
