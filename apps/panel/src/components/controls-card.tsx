import { useState } from 'react'
import { CircleAlert, Power, SlidersHorizontal } from 'lucide-react'
import type { PanelControls, PanelFeatureName } from '@clara/shared-types'
import { postPanel } from '../lib/panel-api.ts'
import { Badge, Card, CardBody, CardHeader, type Tone } from './primitives.tsx'

const FEATURE_COPY: Record<PanelFeatureName, { title: string; description: string }> = {
  opencode: {
    title: 'OpenCode connection',
    description: 'Proxy /api requests and monitor events for push.',
  },
  local: {
    title: 'Local transport',
    description: 'The loopback WebSocket listener paired devices use.',
  },
  relay: {
    title: 'Relay',
    description: 'The outbound WebSocket to the Cloudflare relay.',
  },
  push: {
    title: 'Push notifications',
    description: 'Deliver alerts while Clara is closed.',
  },
}

type Pending = PanelFeatureName | 'agent' | undefined

export function ControlsCard({
  controls,
  onChanged,
}: {
  controls: PanelControls
  onChanged: () => void
}) {
  const [pending, setPending] = useState<Pending>()
  const [error, setError] = useState<string>()

  const run = async (target: Exclude<Pending, undefined>, action: () => Promise<void>) => {
    setPending(target)
    setError(undefined)
    try {
      await action()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const setFeature = (feature: PanelFeatureName, enabled: boolean) => {
    void run(feature, () => postPanel('/panel/api/v1/features', { feature, enabled }))
  }

  const setStopped = () => {
    const stopped = !controls.stopped
    if (
      stopped &&
      !window.confirm(
        'Stop all external connections? The panel stays available so you can start the agent again.'
      )
    ) {
      return
    }
    void run('agent', () => postPanel('/panel/api/v1/agent', { stopped }))
  }

  const busy = pending !== undefined

  return (
    <Card>
      <CardHeader
        title="Agent controls"
        description="Saved settings are restored whenever the agent starts again"
        icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
        action={
          <Badge tone={controls.stopped ? 'warning' : 'success'}>
            {controls.stopped ? 'Stopped' : 'Running'}
          </Badge>
        }
      />
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {controls.stopped ? 'External connections are off' : 'External connections are on'}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {controls.stopped
                ? 'The process, panel, and database keep running.'
                : 'Stopping keeps the panel available to start the agent again.'}
            </p>
          </div>
          <button
            type="button"
            onClick={setStopped}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
              controls.stopped
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            <Power className="size-3.5" aria-hidden="true" />
            {pending === 'agent'
              ? controls.stopped
                ? 'Starting…'
                : 'Stopping…'
              : controls.stopped
                ? 'Start agent'
                : 'Stop agent'}
          </button>
        </div>

        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {controls.features.map((feature) => {
            const copy = FEATURE_COPY[feature.name]
            const disabled = busy || controls.stopped
            const tone: Tone = !feature.configured
              ? 'neutral'
              : feature.effective
                ? 'success'
                : feature.desired
                  ? 'warning'
                  : 'neutral'
            const status = !feature.configured
              ? 'Not configured'
              : feature.effective
                ? 'Effective'
                : feature.desired
                  ? 'Not active'
                  : 'Off'

            return (
              <li
                key={feature.name}
                className="flex items-start justify-between gap-4 py-3 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{copy.title}</span>
                    <Badge tone={tone}>{status}</Badge>
                    {feature.desired !== feature.effective ? (
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        saved {feature.desired ? 'on' : 'off'}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {copy.description}
                  </p>
                  {feature.error ? (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {feature.error}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feature.desired}
                  aria-label={`${copy.title}: ${feature.desired ? 'on' : 'off'}`}
                  onClick={() => setFeature(feature.name, !feature.desired)}
                  disabled={disabled}
                  title={controls.stopped ? 'Start the agent before changing features' : undefined}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    feature.desired
                      ? 'border-emerald-600 bg-emerald-600'
                      : 'border-neutral-300 bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800'
                  }`}
                >
                  <span
                    className={`inline-block size-4 rounded-full bg-white shadow transition ${
                      feature.desired ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </li>
            )
          })}
        </ul>

        {controls.stopped ? (
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            Feature changes are disabled while the agent is stopped. Start it first; the saved
            on/off choices return with it.
          </p>
        ) : null}

        {error ? (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}
