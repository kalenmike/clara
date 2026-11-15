import { Suspense, useEffect, useState } from 'react'
import { Bell, Radio, Server, Settings2 } from 'lucide-react'
import type {
  LocalAccessMode,
  PanelAgentInfo,
  PanelConfigInfo,
  PanelControls,
  PanelLocalTransport,
  PanelPushInfo,
  PanelRelayTransport,
  PanelValueSource,
} from '@clara/shared-types'
import { CloudflareRelaySlot } from '../features/cloudflare-deployment/loader.tsx'
import {
  LOCAL_TRANSPORT_LOCK_REASON,
  RELAY_TRANSPORT_LOCK_REASON,
  usePanelCapabilities,
} from '../lib/capabilities-context.ts'
import { findFeature, useFeatureControl } from '../lib/feature-control.ts'
import { usePushStorageControl } from '../lib/push-storage.ts'
import { ConfirmDialog } from './confirm-dialog.tsx'
import { RelayEditor } from './relay-editor.tsx'
import { HubPowerButton } from './hub-power-button.tsx'
import {
  formatBytes,
  formatDuration,
  formatRelative,
  formatTimestamp,
  sourceLabel,
} from '../lib/format.ts'
import { postPanel } from '../lib/panel-api.ts'
import { PEEK_MASK } from '../lib/peek.ts'
import { usePeek } from '../lib/peek-context.tsx'
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
  const [error, setError] = useState<string>()
  const stopped = controls.stopped
  const { masked, redact } = usePeek()

  return (
    <CollapsibleCard
      title="Hub"
      description="The hub service and its pairing state"
      icon={<Server className="size-4" aria-hidden="true" />}
      defaultExpanded
      action={
        <Badge tone={agent.stopped ? 'warning' : 'success'}>
          {agent.stopped ? 'Connections off' : 'Connections on'}
        </Badge>
      }
      control={<HubPowerButton stopped={stopped} onChanged={onChanged} onError={setError} />}
      notice={
        error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(error)}</Notice>
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
          {agent.container ? `container · pid ${agent.pid}` : `${agent.pid} · ${agent.node}`}
        </KeyValue>
        <KeyValue label="Platform" mono>
          {agent.platform}/{agent.arch}
        </KeyValue>
        <KeyValue label="Memory">{formatBytes(agent.memoryRssBytes)} RSS</KeyValue>
        <KeyValue label="Config" mono title={masked ? undefined : agent.configPath}>
          {masked ? PEEK_MASK : agent.configPath}
        </KeyValue>
        <KeyValue label="Paired devices">{agent.pairedDevices}</KeyValue>
      </CardBody>
    </CollapsibleCard>
  )
}

export function LocalCard({
  local,
  config,
  sessions,
  controls,
  onChanged,
  defaultExpanded = false,
}: {
  local: PanelLocalTransport
  config: PanelConfigInfo
  sessions: number
  controls: PanelControls
  onChanged: () => void
  defaultExpanded?: boolean
}) {
  const feature = findFeature(controls, 'local')
  const { allowLocalToggle } = usePanelCapabilities()
  const control = useFeatureControl(feature, controls.stopped, onChanged, {
    locked: !allowLocalToggle,
    reason: LOCAL_TRANSPORT_LOCK_REASON,
  })
  const { masked, redact } = usePeek()
  const tone: Tone = local.active ? 'success' : local.desired ? 'warning' : 'neutral'
  const status = local.active ? 'Listening' : local.desired ? 'Unavailable' : 'Off'
  return (
    <CollapsibleCard
      title="Local transport"
      description="The WebSocket browsers and adapters pair with"
      icon={<Radio className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      defaultExpanded={defaultExpanded}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`Local transport: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          stopped={controls.stopped}
          title={control.title}
        />
      }
      notice={
        control.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(control.error)}</Notice>
          </div>
        ) : control.lockReason ? (
          <div className="px-4 pt-3">
            <Notice>{control.lockReason}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <KeyValue label="WebSocket">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="font-mono text-xs">{masked ? PEEK_MASK : local.url}</span>
            {masked ? null : <CopyButton value={local.url} label="Copy URL" />}
          </span>
        </KeyValue>
        <KeyValue label="Host" mono>
          {masked ? PEEK_MASK : `${local.host}:${local.port}`}
        </KeyValue>
        <KeyValue label="Desired">{local.desired ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Effective">{local.effective ? 'On' : 'Off'}</KeyValue>
        <KeyValue label="Socket connections">{local.connections}</KeyValue>
        <KeyValue label="E2EE sessions">{sessions}</KeyValue>
        <LocalAccessControl local={local} config={config} onChanged={onChanged} />
        {local.error ? <Notice>{redact(local.error)}</Notice> : null}
        <p className="pt-2 text-xs text-muted-foreground">
          Sessions are authenticated with a per-device key. The panel never sees or displays that
          key.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}

function LocalAccessControl({
  local,
  config,
  onChanged,
}: {
  local: PanelLocalTransport
  config: PanelConfigInfo
  onChanged: () => void
}) {
  const access = config.localAccess?.value ?? 'loopback'
  const accessSource = config.localAccess?.source ?? 'default'
  const bindSource = config.localBindHost?.source ?? 'none'
  const storedBind = config.localBindHost?.value ?? ''
  const [mode, setMode] = useState<LocalAccessMode>(access)
  const [custom, setCustom] = useState(storedBind)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const locked = accessSource === 'env' || bindSource === 'env'
  const { masked, redact } = usePeek()

  useEffect(() => {
    setMode(access)
    setCustom(storedBind)
  }, [access, storedBind])

  const save = () => {
    setSaving(true)
    setError(undefined)
    void postPanel('/panel/api/v1/config', {
      localAccess: mode,
      ...(mode === 'custom' ? { localBindHost: custom.trim() } : {}),
    })
      .then(onChanged)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => setSaving(false))
  }

  const addresses = local.addresses ?? []
  const wildcard = mode === 'lan' || (mode === 'custom' && custom.trim() === '0.0.0.0')
  return (
    <>
      <KeyValue label="Direct access">
        <span className="inline-flex items-center gap-2">
          <span className="text-xs">{accessModeLabel(access)}</span>
          <SourceTag source={accessSource} />
        </span>
      </KeyValue>
      <div className="mt-2 grid gap-2 rounded-md border border-border p-2">
        <label className="grid gap-1 text-[11px] font-medium text-foreground">
          Listen on
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as LocalAccessMode)}
            disabled={locked || saving}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          >
            <option value="loopback">This machine only (127.0.0.1)</option>
            <option value="docker">This machine and local Docker containers</option>
            <option value="lan">All interfaces (LAN and Docker)</option>
            <option value="custom">Custom address</option>
          </select>
        </label>
        {mode === 'custom' ? (
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="192.168.1.20"
            spellCheck={false}
            disabled={locked || saving}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11px]"
          />
        ) : null}
        {wildcard ? (
          <Notice>
            All interfaces exposes the hub WebSocket and API to your network. Keep the port behind
            your firewall, or use the relay for remote machines.
          </Notice>
        ) : null}
        {locked ? (
          <Notice>
            A startup environment variable owns this setting. Remove it and restart the hub to edit
            it here.
          </Notice>
        ) : null}
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={locked || saving || (mode === 'custom' && !custom.trim())}
            className="panel-button"
          >
            {saving ? 'Saving…' : 'Save direct access'}
          </button>
        </div>
      </div>
      {addresses.length > 0 ? (
        <div className="mt-2 space-y-1">
          {addresses.map((address) => (
            <KeyValue key={address.url} label={addressScopeLabel(address.scope)} mono>
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-[11px]">{masked ? PEEK_MASK : address.url}</span>
                {masked ? null : <CopyButton value={address.url} label="Copy" />}
              </span>
            </KeyValue>
          ))}
        </div>
      ) : null}
    </>
  )
}

function accessModeLabel(mode: LocalAccessMode): string {
  if (mode === 'docker') return 'This machine + Docker'
  if (mode === 'lan') return 'All interfaces'
  if (mode === 'custom') return 'Custom'
  return 'This machine'
}

function addressScopeLabel(scope: string): string {
  if (scope === 'docker') return 'Docker URL'
  if (scope === 'lan') return 'LAN URL'
  return 'Loopback URL'
}

export function RelayCard({
  relay,
  controls,
  onChanged,
  now,
  defaultExpanded = false,
}: {
  relay: PanelRelayTransport
  controls: PanelControls
  onChanged: () => void
  now: number
  defaultExpanded?: boolean
}) {
  const feature = findFeature(controls, 'relay')
  const { allowRelayToggle } = usePanelCapabilities()
  const control = useFeatureControl(feature, controls.stopped, onChanged, {
    locked: !allowRelayToggle,
    reason: RELAY_TRANSPORT_LOCK_REASON,
  })
  const { masked, redact } = usePeek()
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
      description="Outbound remote access through a relay"
      icon={<Radio className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      defaultExpanded={defaultExpanded}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`Relay: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          stopped={controls.stopped}
          title={control.title}
        />
      }
      notice={
        control.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(control.error)}</Notice>
          </div>
        ) : control.lockReason ? (
          <div className="px-4 pt-3">
            <Notice>{control.lockReason}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        {relay.configured ? (
          <>
            <KeyValue label="Relay URL" mono>
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span>{masked ? PEEK_MASK : relay.url}</span>
                {relay.urlSource ? <SourceTag source={sourceLabel(relay.urlSource)} /> : null}
              </span>
            </KeyValue>
            <KeyValue label="Room">
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span className="font-mono text-xs">{masked ? PEEK_MASK : relay.room}</span>
                {relay.roomSource ? <SourceTag source={sourceLabel(relay.roomSource)} /> : null}
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
            <KeyValue label="Hub token">
              {relay.agentTokenConfigured ? 'Configured' : 'Missing'}
            </KeyValue>
            {relay.error ? <Notice>{redact(relay.error)}</Notice> : null}
            {relay.lastError ? <Notice>{redact(relay.lastError)}</Notice> : null}
          </>
        ) : (
          <>
            <EmptyState>
              This hub is local-only. Save a relay URL and hub token below to enable remote access.
            </EmptyState>
            <p className="pt-2 text-xs text-muted-foreground">
              A relay-disabled hub still serves the local WebSocket and this panel.
            </p>
          </>
        )}
        <RelayEditor relay={relay} onChanged={onChanged} />
        {CloudflareRelaySlot ? (
          <Suspense fallback={null}>
            <CloudflareRelaySlot relay={relay} now={now} onChanged={onChanged} />
          </Suspense>
        ) : null}
      </CardBody>
    </CollapsibleCard>
  )
}

export function PushCard({
  push,
  controls,
  onChanged,
  defaultExpanded = false,
}: {
  push: PanelPushInfo
  controls: PanelControls
  onChanged: () => void
  defaultExpanded?: boolean
}) {
  const feature = findFeature(controls, 'push')
  const control = useFeatureControl(feature, controls.stopped, onChanged)
  const storage = usePushStorageControl(onChanged)
  const [confirmReset, setConfirmReset] = useState(false)
  const { redact } = usePeek()
  const tone: Tone = push.effective ? (push.failing > 0 ? 'warning' : 'success') : 'neutral'
  const status = push.effective ? 'Enabled' : push.desired ? 'Not active' : 'Off'
  const canManageStorage = push.vapidConfigured && !push.storageAvailable
  return (
    <CollapsibleCard
      title="Push"
      description="Web Push delivery while Clara is closed"
      icon={<Bell className="size-4" aria-hidden="true" />}
      action={<Badge tone={tone}>{status}</Badge>}
      defaultExpanded={defaultExpanded}
      expandable={feature.desired}
      control={
        <Toggle
          checked={feature.desired}
          onChange={control.toggle}
          label={`Push notifications: ${feature.desired ? 'on' : 'off'}`}
          state={control.pending ? 'pending' : feature.desired ? 'on' : 'off'}
          disabled={control.disabled}
          stopped={controls.stopped}
          title={control.title}
        />
      }
      notice={
        control.error || storage.error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(control.error ?? storage.error ?? '')}</Notice>
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
          {push.vapidConfigured ? 'Configured' : 'Not configured'}
        </KeyValue>
        <KeyValue label="Subscription storage">
          {push.storageAvailable ? 'Ready' : 'Unavailable'}
        </KeyValue>
        {push.storageError ? <Notice>{redact(push.storageError)}</Notice> : null}
        {canManageStorage ? (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <button
              type="button"
              className="panel-button"
              onClick={storage.reload}
              disabled={storage.pending !== null}
            >
              {storage.pending === 'reload' ? 'Checking…' : 'Retry storage'}
            </button>
            <button
              type="button"
              className="panel-button danger"
              onClick={() => setConfirmReset(true)}
              disabled={storage.pending !== null}
            >
              Reset subscriptions
            </button>
          </div>
        ) : null}
        {push.error ? <Notice>{redact(push.error)}</Notice> : null}
        <p className="pt-2 text-xs text-muted-foreground">
          Push endpoints are never exposed by the panel.
        </p>
      </CardBody>
      <ConfirmDialog
        open={confirmReset}
        title="Reset push subscriptions?"
        description="This deletes every stored push subscription on this hub. Each device must enable notifications again."
        confirmLabel="Reset subscriptions"
        pendingLabel="Resetting…"
        pending={storage.pending === 'reset'}
        danger
        onOpenChange={(open) => {
          if (!open) setConfirmReset(false)
        }}
        onConfirm={() => {
          storage.reset()
          setConfirmReset(false)
        }}
      />
    </CollapsibleCard>
  )
}

export function ConfigCard({
  config,
  onChanged,
}: {
  config: PanelConfigInfo
  onChanged: () => void
}) {
  return (
    <CollapsibleCard
      title="Effective configuration"
      description="Where each value came from. The Web URL and VAPID contact can be edited here."
      icon={<Settings2 className="size-4" aria-hidden="true" />}
      defaultExpanded
    >
      <CardBody>
        <ConfigRow
          label="Local host"
          value={config.localHost.value}
          source={config.localHost.source}
          mono
          sensitive
        />
        <ConfigRow
          label="Local port"
          value={String(config.localPort.value)}
          source={config.localPort.source}
          mono
          sensitive
        />
        <ConfigRow
          label="Relay URL"
          value={config.relayUrl.value ?? 'Not configured'}
          source={config.relayUrl.source}
          mono={Boolean(config.relayUrl.value)}
          sensitive
        />
        <ConfigRow
          label="Relay room"
          value={config.relayRoom.value ?? 'Not configured'}
          source={config.relayRoom.source}
          mono={Boolean(config.relayRoom.value)}
          sensitive
        />
        <ConfigEditorRow
          id="config-web-url"
          label="Web URL"
          field="pairingBaseUrl"
          value={config.pairingBaseUrl.value}
          source={config.pairingBaseUrl.source}
          sourceText={sourceLabel(config.pairingBaseUrl.source)}
          hint="Pairing links open this URL."
          savedHint="Saved in server.json."
          defaultHint="Using the local default."
          envHint="Set by CLARA_PAIRING_BASE_URL. Remove it and restart the hub service to edit here."
          placeholder="http://127.0.0.1:8080"
          mono
          onChanged={onChanged}
        />
        <ConfigEditorRow
          id="config-vapid-subject"
          label="VAPID contact"
          field="vapidSubject"
          value={config.vapidSubject.value}
          source={config.vapidSubject.source}
          sourceText={
            config.vapidSubject.source === 'file'
              ? 'vapid.json'
              : sourceLabel(config.vapidSubject.source)
          }
          hint="Web Push contact: an HTTPS URL or a mailto: address."
          savedHint="Saved in vapid.json."
          defaultHint="Using https://clara.local."
          envHint="Set by CLARA_VAPID_SUBJECT. Remove it and restart the hub service to edit here."
          placeholder="https://clara.local"
          mono
          onChanged={onChanged}
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
  sensitive = false,
}: {
  label: string
  value: string
  source: PanelValueSource
  mono?: boolean
  sensitive?: boolean
}) {
  const { masked } = usePeek()
  const display = sensitive && masked && value !== 'Not configured' ? PEEK_MASK : value

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <span className={`break-all text-right text-foreground ${mono ? 'font-mono text-xs' : ''}`}>
          {display}
        </span>
        <SourceTag source={sourceLabel(source)} />
      </span>
    </div>
  )
}

export function ConfigEditorRow({
  id,
  label,
  field,
  value,
  source,
  sourceText,
  hint,
  savedHint,
  defaultHint,
  envHint,
  placeholder,
  mono = false,
  onChanged,
}: {
  id: string
  label: string
  field: 'pairingBaseUrl' | 'adapterRegistryUrl' | 'vapidSubject'
  value: string
  source: PanelValueSource
  sourceText: string
  hint: string
  savedHint: string
  defaultHint: string
  envHint: string
  placeholder: string
  mono?: boolean
  onChanged: () => void
}) {
  const { redact } = usePeek()
  const [draft, setDraft] = useState(value)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const locked = source === 'env'
  const disabled = locked || pending

  // Keep a local draft so the five-second poll cannot overwrite typing.
  useEffect(() => {
    if (!dirty) setDraft(value)
  }, [value, dirty])

  const submit = async (next: string | null) => {
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/config', { [field]: next })
      setDirty(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const save = () => {
    const next = draft.trim()
    void submit(next ? next : null)
  }

  const clear = () => {
    setDraft('')
    setDirty(true)
    void submit(null)
  }

  return (
    <div className="border-b border-border py-2 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <SourceTag source={sourceText} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="url"
          value={locked ? value : draft}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value)
            setDirty(true)
          }}
          className={`min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-sm outline-none transition focus:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground ${mono ? 'font-mono' : ''}`}
        />
        <button
          type="button"
          onClick={save}
          disabled={disabled || !dirty}
          className="inline-flex items-center rounded-md border border-border px-2 py-1 text-[11px] font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || source === 'default'}
          className="inline-flex items-center rounded-md border border-border px-2 py-1 text-[11px] font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use default
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {locked ? envHint : source === 'file' ? `${hint} ${savedHint}` : `${hint} ${defaultHint}`}
      </p>
      {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
    </div>
  )
}
