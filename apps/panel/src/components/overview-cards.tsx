import { useState } from 'react'
import { Bell, Cpu, Power, Radio, Server, Settings2 } from 'lucide-react'
import type {
  PanelAgentInfo,
  PanelConfigInfo,
  PanelControls,
  PanelLocalTransport,
  PanelOpenCodeInfo,
  PanelPushInfo,
  PanelRelayTransport,
} from '@clara/shared-types'
import { findFeature, useFeatureControl } from '../lib/feature-control.ts'
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatTimestamp,
  sourceLabel,
} from '../lib/format.ts'
import { postPanel } from '../lib/panel-api.ts'
import {
  Badge,
  CardBody,
  CollapsibleCard,
  CopyButton,
  EmptyState,
  KeyValue,
  Muted,
  Notice,
  SourceTag,
  Toggle,
  type Tone,
} from './primitives.tsx'

export function AgentCard({
  agent,
  controls,
  onChanged,
  now,
}: {
  agent: PanelAgentInfo
  controls: PanelControls
  onChanged: () => void
  now: number
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const stopped = controls.stopped

  const setStopped = async () => {
    const next = !stopped
    if (
      next &&
      !window.confirm(
        'Stop all external connections? The panel stays available so you can start the agent again.'
      )
    ) {
      return
    }
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/agent', { stopped: next })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <CollapsibleCard
      title="Agent"
      description="The home agent process and its pairing state"
      icon={<Server className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={agent.stopped ? 'warning' : 'success'}>
          {agent.stopped ? 'Stopped' : 'Running'}
        </Badge>
      }
      control={
        <button
          type="button"
          onClick={() => void setStopped()}
          disabled={pending}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
            stopped ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          <Power className="size-3.5" aria-hidden="true" />
          {pending ? (stopped ? 'Starting…' : 'Stopping…') : stopped ? 'Start agent' : 'Stop agent'}
        </button>
      }
      notice={
        error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <KeyValue label="External connections">
          {agent.stopped ? 'Off by admin setting' : 'Enabled per feature'}
        </KeyValue>
        <KeyValue label="Version">
          {agent.version} <Muted>· protocol {agent.protocol}</Muted>
        </KeyValue>
        <KeyValue label="Uptime">{formatDuration(agent.uptimeMs)}</KeyValue>
        <KeyValue label="Started" title={formatTimestamp(agent.startedAt)}>
          {formatRelative(agent.startedAt, now)}
        </KeyValue>
        <KeyValue label="Process" mono>
          {agent.pid} · {agent.node}
        </KeyValue>
        <KeyValue label="Platform" mono>
          {agent.platform}/{agent.arch}
        </KeyValue>
        <KeyValue label="Memory">{formatBytes(agent.memoryRssBytes)} RSS</KeyValue>
        <KeyValue label="Config" mono title={agent.configPath}>
          {agent.configPath}
        </KeyValue>
        <KeyValue label="Pairing key" mono title={agent.fingerprint}>
          {agent.fingerprint ?? 'fingerprint unavailable'}
        </KeyValue>
        <KeyValue label="PSK">{agent.pskConfigured ? 'Configured' : 'Not configured'}</KeyValue>
      </CardBody>
    </CollapsibleCard>
  )
}

export function OpenCodeCard({
  opencode,
  controls,
  onChanged,
  now,
}: {
  opencode: PanelOpenCodeInfo
  controls: PanelControls
  onChanged: () => void
  now: number
}) {
  const feature = findFeature(controls, 'opencode')
  const control = useFeatureControl(feature, controls.stopped, onChanged)
  const disabled = opencode.code === 'disabled'
  const tone: Tone = disabled
    ? 'neutral'
    : opencode.reachable
      ? 'success'
      : opencode.code === 'auth'
        ? 'warning'
        : 'danger'
  const status = disabled
    ? 'Disabled'
    : opencode.reachable
      ? 'Reachable'
      : opencode.code === 'auth'
        ? 'Auth rejected'
        : opencode.code === 'timeout'
          ? 'Timed out'
          : 'Unreachable'

  return (
    <CollapsibleCard
      title="OpenCode"
      description="The upstream server this agent proxies"
      icon={<Cpu className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`OpenCode connection: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          title={control.title}
        />
      }
      notice={
        control.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{control.error}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <KeyValue label="URL">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="font-mono text-xs">{opencode.url}</span>
            <CopyButton value={opencode.url} label="Copy URL" />
          </span>
        </KeyValue>
        <KeyValue label="Desired">{opencode.desired ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Effective">{opencode.effective ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Version">{opencode.version ?? 'Unknown'}</KeyValue>
        <KeyValue label="Latency">{opencode.latencyMs ?? '—'} ms</KeyValue>
        <KeyValue label="Password">
          {opencode.passwordConfigured ? 'Configured' : 'Not configured'}
        </KeyValue>
        <KeyValue label="Checked" title={formatTimestamp(opencode.checkedAt)}>
          {formatRelative(opencode.checkedAt, now)}
        </KeyValue>
        {opencode.error && !disabled ? <Notice tone="danger">{opencode.error}</Notice> : null}
      </CardBody>
    </CollapsibleCard>
  )
}

export function LocalCard({
  local,
  sessions,
  controls,
  onChanged,
}: {
  local: PanelLocalTransport
  sessions: number
  controls: PanelControls
  onChanged: () => void
}) {
  const feature = findFeature(controls, 'local')
  const control = useFeatureControl(feature, controls.stopped, onChanged)
  const tone: Tone = local.active ? 'success' : local.desired ? 'warning' : 'neutral'
  const status = local.active ? 'Listening' : local.desired ? 'Unavailable' : 'Off'
  return (
    <CollapsibleCard
      title="Local transport"
      description="The loopback WebSocket the browser pairs with"
      icon={<Radio className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`Local transport: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          title={control.title}
        />
      }
      notice={
        control.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{control.error}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <KeyValue label="WebSocket">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="font-mono text-xs">{local.url}</span>
            <CopyButton value={local.url} label="Copy URL" />
          </span>
        </KeyValue>
        <KeyValue label="Host" mono>
          {local.host}:{local.port}
        </KeyValue>
        <KeyValue label="Desired">{local.desired ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Effective">{local.effective ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Socket connections">{local.connections}</KeyValue>
        <KeyValue label="E2EE sessions">{sessions}</KeyValue>
        {local.error ? <Notice>{local.error}</Notice> : null}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Sessions are authenticated with the pairing key. The panel never sees or displays that
          key.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}

export function RelayCard({
  relay,
  controls,
  onChanged,
  now,
}: {
  relay: PanelRelayTransport
  controls: PanelControls
  onChanged: () => void
  now: number
}) {
  const feature = findFeature(controls, 'relay')
  const control = useFeatureControl(feature, controls.stopped, onChanged)
  const tone: Tone =
    relay.status === 'online'
      ? 'success'
      : relay.status === 'connecting' || relay.status === 'reconnecting'
        ? 'warning'
        : relay.status === 'offline' || relay.status === 'stopped'
          ? 'danger'
          : 'neutral'
  const status =
    relay.status === 'stopped'
      ? 'Stopped'
      : relay.status === 'disabled'
        ? relay.configured
          ? 'Off'
          : 'Not configured'
        : relay.status.charAt(0).toUpperCase() + relay.status.slice(1)

  return (
    <CollapsibleCard
      title="Relay"
      description="Outbound remote access through Cloudflare"
      icon={<Radio className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`Relay: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          title={control.title}
        />
      }
      notice={
        control.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{control.error}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        {relay.configured ? (
          <>
            <KeyValue label="Relay URL" mono>
              {relay.url}
            </KeyValue>
            <KeyValue label="Room">
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span className="font-mono text-xs">{relay.room}</span>
                {relay.room ? <CopyButton value={relay.room} label="Copy room" /> : null}
              </span>
            </KeyValue>
            <KeyValue label="Desired">{relay.desired ? 'On' : 'Off'}</KeyValue>
            <KeyValue label="Effective">{relay.effective ? 'On' : 'Off'}</KeyValue>
            <KeyValue label="Connected">
              {relay.connectedSince ? formatRelative(relay.connectedSince, now) : 'Not connected'}
            </KeyValue>
            <KeyValue label="Last change" title={formatTimestamp(relay.lastChangedAt ?? '')}>
              {relay.lastChangedAt ? formatRelative(relay.lastChangedAt, now) : '—'}
            </KeyValue>
            <KeyValue label="Reconnect attempts">{relay.reconnectAttempts ?? 0}</KeyValue>
            <KeyValue label="Tokens">
              {relay.agentTokenConfigured && relay.clientTokenConfigured
                ? 'Agent and client configured'
                : 'Missing a token'}
            </KeyValue>
            {relay.error ? <Notice>{relay.error}</Notice> : null}
            {relay.lastError ? <Notice>{relay.lastError}</Notice> : null}
          </>
        ) : (
          <>
            <EmptyState>
              This agent is local-only. Set <span className="font-mono">CLARA_RELAY_URL</span>, a
              room, and both tokens to enable remote access.
            </EmptyState>
            <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
              A relay-disabled agent still serves the local WebSocket and this panel.
            </p>
          </>
        )}
      </CardBody>
    </CollapsibleCard>
  )
}

export function PushCard({
  push,
  controls,
  onChanged,
}: {
  push: PanelPushInfo
  controls: PanelControls
  onChanged: () => void
}) {
  const feature = findFeature(controls, 'push')
  const control = useFeatureControl(feature, controls.stopped, onChanged)
  const tone: Tone = push.effective ? (push.failing > 0 ? 'warning' : 'success') : 'neutral'
  const status = push.effective ? 'Enabled' : push.desired ? 'Not active' : 'Off'
  return (
    <CollapsibleCard
      title="Push"
      description="Web Push delivery while Clara is closed"
      icon={<Bell className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`Push notifications: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          title={control.title}
        />
      }
      notice={
        control.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{control.error}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <KeyValue label="Desired">{push.desired ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Effective">{push.effective ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Subscriptions">{push.subscriptions}</KeyValue>
        <KeyValue label="Delivery problems">{push.failing}</KeyValue>
        <KeyValue label="VAPID key">
          {push.publicKeyConfigured ? 'Configured' : 'Not configured'}
        </KeyValue>
        {push.error ? <Notice>{push.error}</Notice> : null}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Push endpoints are never exposed by the panel.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}

export function ConfigCard({ config }: { config: PanelConfigInfo }) {
  return (
    <CollapsibleCard
      title="Effective configuration"
      description="Where each value came from, without showing secrets"
      icon={<Settings2 className="size-4" aria-hidden="true" />}
    >
      <CardBody>
        <ConfigRow
          label="OpenCode URL"
          value={config.opencodeUrl.value}
          source={config.opencodeUrl.source}
        />
        <ConfigRow
          label="OpenCode password"
          value={config.opencodePassword.value ? 'Configured' : 'Not set'}
          source={config.opencodePassword.source}
        />
        <ConfigRow
          label="Local host"
          value={config.localHost.value}
          source={config.localHost.source}
          mono
        />
        <ConfigRow
          label="Local port"
          value={String(config.localPort.value)}
          source={config.localPort.source}
          mono
        />
        <ConfigRow
          label="Relay URL"
          value={config.relayUrl.value ?? 'Not configured'}
          source={config.relayUrl.source}
          mono={Boolean(config.relayUrl.value)}
        />
        <ConfigRow
          label="Relay room"
          value={config.relayRoom.value ?? 'Not configured'}
          source={config.relayRoom.source}
          mono={Boolean(config.relayRoom.value)}
        />
        <ConfigRow
          label="Pairing base URL"
          value={config.pairingBaseUrl.value}
          source={config.pairingBaseUrl.source}
        />
      </CardBody>
    </CollapsibleCard>
  )
}

function ConfigRow({
  label,
  value,
  source,
  mono = false,
}: {
  label: string
  value: string
  source: PanelConfigInfo['opencodeUrl']['source']
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 py-1.5 text-sm last:border-0 dark:border-neutral-800/60">
      <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <span
          className={`break-all text-right text-neutral-900 dark:text-neutral-100 ${mono ? 'font-mono text-xs' : ''}`}
        >
          {value}
        </span>
        <SourceTag source={sourceLabel(source)} />
      </span>
    </div>
  )
}
