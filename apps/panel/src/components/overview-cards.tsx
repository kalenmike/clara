import { Bell, Cpu, Radio, Server, Settings2 } from 'lucide-react'
import type {
  PanelAgentInfo,
  PanelConfigInfo,
  PanelLocalTransport,
  PanelOpenCodeInfo,
  PanelPushInfo,
  PanelRelayTransport,
} from '@clara/shared-types'
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatTimestamp,
  sourceLabel,
} from '../lib/format.ts'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  KeyValue,
  Muted,
  SourceTag,
  type Tone,
} from './primitives.tsx'

export function AgentCard({ agent, now }: { agent: PanelAgentInfo; now: number }) {
  return (
    <Card>
      <CardHeader
        title="Agent"
        description="The home agent process and its pairing state"
        icon={<Server className="size-4" aria-hidden="true" />}
        action={<Badge tone="success">Running</Badge>}
      />
      <CardBody>
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
    </Card>
  )
}

export function OpenCodeCard({ opencode, now }: { opencode: PanelOpenCodeInfo; now: number }) {
  const tone: Tone = opencode.reachable
    ? 'success'
    : opencode.code === 'auth'
      ? 'warning'
      : 'danger'
  const status = opencode.reachable
    ? 'Reachable'
    : opencode.code === 'auth'
      ? 'Auth rejected'
      : opencode.code === 'timeout'
        ? 'Timed out'
        : 'Unreachable'

  return (
    <Card>
      <CardHeader
        title="OpenCode"
        description="The upstream server this agent proxies"
        icon={<Cpu className="size-4" aria-hidden="true" />}
        action={<Badge tone={tone}>{status}</Badge>}
      />
      <CardBody>
        <KeyValue label="URL">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="font-mono text-xs">{opencode.url}</span>
            <CopyButton value={opencode.url} label="Copy URL" />
          </span>
        </KeyValue>
        <KeyValue label="Version">{opencode.version ?? 'Unknown'}</KeyValue>
        <KeyValue label="Latency">{opencode.latencyMs ?? '—'} ms</KeyValue>
        <KeyValue label="Password">
          {opencode.passwordConfigured ? 'Configured' : 'Not configured'}
        </KeyValue>
        <KeyValue label="Checked" title={formatTimestamp(opencode.checkedAt)}>
          {formatRelative(opencode.checkedAt, now)}
        </KeyValue>
        {opencode.error ? (
          <p className="mt-2 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {opencode.error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}

export function LocalCard({ local, sessions }: { local: PanelLocalTransport; sessions: number }) {
  return (
    <Card>
      <CardHeader
        title="Local transport"
        description="The loopback WebSocket the browser pairs with"
        icon={<Radio className="size-4" aria-hidden="true" />}
        action={<Badge tone="success">Listening</Badge>}
      />
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
        <KeyValue label="Socket connections">{local.connections}</KeyValue>
        <KeyValue label="E2EE sessions">{sessions}</KeyValue>
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Sessions are authenticated with the pairing key. The panel never sees or displays that
          key.
        </p>
      </CardBody>
    </Card>
  )
}

export function RelayCard({ relay, now }: { relay: PanelRelayTransport; now: number }) {
  const tone: Tone =
    relay.status === 'online'
      ? 'success'
      : relay.status === 'connecting' || relay.status === 'reconnecting'
        ? 'warning'
        : relay.status === 'offline'
          ? 'danger'
          : 'neutral'
  const status =
    relay.status === 'disabled'
      ? 'Not configured'
      : relay.status.charAt(0).toUpperCase() + relay.status.slice(1)

  return (
    <Card>
      <CardHeader
        title="Relay"
        description="Outbound remote access through Cloudflare"
        icon={<Radio className="size-4" aria-hidden="true" />}
        action={<Badge tone={tone}>{status}</Badge>}
      />
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
            <KeyValue label="Connected">
              {relay.connectedSince ? formatRelative(relay.connectedSince, now) : 'Not connected'}
            </KeyValue>
            <KeyValue label="Last change" title={formatTimestamp(relay.lastChangedAt)}>
              {formatRelative(relay.lastChangedAt, now)}
            </KeyValue>
            <KeyValue label="Reconnect attempts">{relay.reconnectAttempts ?? 0}</KeyValue>
            <KeyValue label="Tokens">
              {relay.agentTokenConfigured && relay.clientTokenConfigured
                ? 'Agent and client configured'
                : 'Missing a token'}
            </KeyValue>
            {relay.lastError ? (
              <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                {relay.lastError}
              </p>
            ) : null}
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
    </Card>
  )
}

export function PushCard({ push }: { push: PanelPushInfo }) {
  const tone: Tone = !push.enabled ? 'neutral' : push.failing > 0 ? 'warning' : 'success'
  return (
    <Card>
      <CardHeader
        title="Push"
        description="Web Push delivery while Clara is closed"
        icon={<Bell className="size-4" aria-hidden="true" />}
        action={<Badge tone={tone}>{push.enabled ? 'Enabled' : 'Disabled'}</Badge>}
      />
      <CardBody>
        <KeyValue label="Subscriptions">{push.subscriptions}</KeyValue>
        <KeyValue label="Delivery problems">{push.failing}</KeyValue>
        <KeyValue label="VAPID key">
          {push.publicKeyConfigured ? 'Configured' : 'Not configured'}
        </KeyValue>
        {push.error ? (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            {push.error}
          </p>
        ) : null}
        <p className="pt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Push endpoints are never exposed by the panel.
        </p>
      </CardBody>
    </Card>
  )
}

export function ConfigCard({ config }: { config: PanelConfigInfo }) {
  return (
    <Card>
      <CardHeader
        title="Effective configuration"
        description="Where each value came from, without showing secrets"
        icon={<Settings2 className="size-4" aria-hidden="true" />}
      />
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
    </Card>
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
