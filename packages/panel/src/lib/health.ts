import type {
  PanelAgentInfo,
  PanelHarnessState,
  PanelLocalTransport,
  PanelOrchestrationControl,
  PanelPushInfo,
  PanelRelayTransport,
  PanelSnapshot,
  PanelStorageEntry,
} from '@clara/shared-types'
import type { PanelTab } from './tabs.ts'

export type HealthTone = 'ok' | 'warn' | 'bad' | 'idle'

export type HealthKey = 'hub' | 'harness' | 'local' | 'relay' | 'push' | 'orchestration'

export type HealthItem = {
  key: HealthKey
  label: string
  status: string
  detail: string
  tone: HealthTone
  tab: PanelTab
}

export type StorageHealth = {
  tone: HealthTone
  label: string
  title: string
  errors: number
  warnings: number
}

const ORCHESTRATION_LABELS = {
  local: 'Running locally',
  container: 'Running in Docker',
  external: 'Running externally',
  stopped: 'Stopped',
  unresponsive: 'Not responding',
  foreign: 'Port in use',
} as const

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function hubHealth(agent: PanelAgentInfo): HealthItem {
  const process = agent.container ? 'container' : `pid ${agent.pid}`
  return {
    key: 'hub',
    label: 'Hub',
    tab: 'settings',
    tone: agent.stopped ? 'idle' : 'ok',
    status: agent.stopped ? 'Connections inactive' : 'Connections active',
    detail: `${agent.platform}/${agent.arch} · ${process} · v${agent.version}`,
  }
}

export function harnessHealth(harness: PanelHarnessState): HealthItem {
  const base = { key: 'harness', label: 'Harness', tab: 'harness' } as const

  if (harness.paired === 0) {
    return { ...base, tone: 'warn', status: 'Not configured', detail: 'Add a harness adapter' }
  }
  if (!harness.effective) {
    return {
      ...base,
      tone: 'idle',
      status: harness.desired ? 'Off' : 'Disabled',
      detail: harness.error || 'Harness access is disabled by an admin setting',
    }
  }
  if (harness.online === 0) {
    return {
      ...base,
      tone: 'warn',
      status: 'All offline',
      detail: harness.error || `${harness.paired} paired, none online`,
    }
  }
  return {
    ...base,
    tone: 'ok',
    status: `${harness.online} of ${harness.paired} online`,
    detail:
      harness.online === harness.paired
        ? 'Every paired harness is online'
        : 'One or more paired harnesses are offline',
  }
}

export function localHealth(local: PanelLocalTransport): HealthItem {
  const base = { key: 'local', label: 'Local', tab: 'connections' } as const
  const detail = local.url || `${local.host}:${local.port}`

  if (local.active) {
    return {
      ...base,
      tone: 'ok',
      status: 'Listening',
      detail: `${detail} · ${countLabel(local.connections, 'socket connection')}`,
    }
  }
  if (local.desired) {
    return { ...base, tone: 'bad', status: 'Unavailable', detail: local.error || detail }
  }
  return { ...base, tone: 'idle', status: 'Off', detail }
}

export function relayHealth(relay: PanelRelayTransport): HealthItem {
  const base = { key: 'relay', label: 'Relay', tab: 'connections' } as const
  const detail = relay.configured
    ? relay.room
      ? `Room ${relay.room}`
      : (relay.url ?? 'Configured')
    : 'Local-only hub'

  switch (relay.status) {
    case 'online':
      return { ...base, tone: 'ok', status: 'Online', detail }
    case 'connecting':
    case 'reconnecting':
      return {
        ...base,
        tone: 'warn',
        status: relay.status === 'connecting' ? 'Connecting' : 'Reconnecting',
        detail: relay.lastError || detail,
      }
    case 'offline':
    case 'stopped':
      return {
        ...base,
        tone: 'bad',
        status: relay.lastError ? 'Offline' : 'Stopped',
        detail: relay.lastError || detail,
      }
    default:
      return {
        ...base,
        tone: 'idle',
        status: relay.configured ? 'Off' : 'Not configured',
        detail,
      }
  }
}

export function pushHealth(push: PanelPushInfo): HealthItem {
  const base = { key: 'push', label: 'Push', tab: 'connections' } as const
  const subscriptions = countLabel(push.subscriptions, 'subscription')

  if (push.error) {
    return { ...base, tone: 'bad', status: 'Error', detail: push.error }
  }
  if (push.effective) {
    if (push.storageError) {
      return { ...base, tone: 'warn', status: 'Storage error', detail: push.storageError }
    }
    if (push.failing > 0) {
      return {
        ...base,
        tone: 'warn',
        status: 'Degraded',
        detail: `${subscriptions} · ${countLabel(push.failing, 'failing delivery', 'failing deliveries')}`,
      }
    }
    return { ...base, tone: 'ok', status: 'Enabled', detail: subscriptions }
  }
  if (push.desired) {
    return { ...base, tone: 'warn', status: 'Not active', detail: subscriptions }
  }
  return { ...base, tone: 'idle', status: 'Off', detail: subscriptions }
}

export function orchestrationHealth(orchestration: PanelOrchestrationControl): HealthItem {
  const base = { key: 'orchestration', label: 'Orchestration', tab: 'overview' } as const
  const label = ORCHESTRATION_LABELS[orchestration.state]
  const detail = orchestration.error || orchestration.url

  if (orchestration.effective) {
    return { ...base, tone: 'ok', status: 'Running', detail: `${label} · ${orchestration.url}` }
  }
  if (orchestration.state === 'unresponsive' || orchestration.state === 'foreign') {
    return { ...base, tone: 'bad', status: label, detail }
  }
  if (orchestration.state === 'stopped') {
    return { ...base, tone: 'idle', status: 'Stopped', detail: 'Not running from this hub' }
  }
  return { ...base, tone: 'warn', status: label, detail }
}

export function storageHealth(storage: PanelStorageEntry[]): StorageHealth {
  const errors = storage.filter((entry) => entry.status === 'error').length
  const warnings = storage.filter(
    (entry) => entry.status === 'warn' || entry.status === 'missing'
  ).length
  const ok = storage.length - errors - warnings

  const title = storage.length
    ? `${ok} OK · ${countLabel(warnings, 'warning')} · ${countLabel(errors, 'error')}`
    : 'No storage entries reported'

  if (errors > 0) {
    return {
      tone: 'bad',
      label: countLabel(errors, 'error'),
      title,
      errors,
      warnings,
    }
  }
  if (warnings > 0) {
    return {
      tone: 'warn',
      label: countLabel(warnings, 'warning'),
      title,
      errors,
      warnings,
    }
  }
  return {
    tone: storage.length ? 'ok' : 'idle',
    label: storage.length ? 'OK' : 'No entries',
    title,
    errors,
    warnings,
  }
}

export function buildHealth(snapshot: PanelSnapshot): HealthItem[] {
  return [
    harnessHealth(snapshot.harness),
    localHealth(snapshot.local),
    relayHealth(snapshot.relay),
    pushHealth(snapshot.push),
    orchestrationHealth(snapshot.controls.orchestration),
  ]
}

/** The Overview strip leads with the hub, then the transports and harness. */
export function overviewHealth(snapshot: PanelSnapshot): HealthItem[] {
  return [
    hubHealth(snapshot.agent),
    localHealth(snapshot.local),
    relayHealth(snapshot.relay),
    harnessHealth(snapshot.harness),
    pushHealth(snapshot.push),
    orchestrationHealth(snapshot.controls.orchestration),
  ]
}

export function needsAttention(item: HealthItem): boolean {
  return item.tone === 'warn' || item.tone === 'bad'
}
