import type {
  PanelLocalTransport,
  PanelOpenCodeInfo,
  PanelOrchestrationControl,
  PanelPushInfo,
  PanelRelayTransport,
  PanelSnapshot,
  PanelStorageEntry,
} from '@clara/shared-types'
import type { PanelTab } from './tabs.ts'

export type HealthTone = 'ok' | 'warn' | 'bad' | 'idle'

export type HealthKey = 'harness' | 'local' | 'relay' | 'push' | 'orchestration'

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

export function harnessHealth(opencode: PanelOpenCodeInfo): HealthItem {
  const base = { key: 'harness', label: 'Harness', tab: 'harness' } as const
  const detail = opencode.version
    ? `OpenCode ${opencode.version}`
    : opencode.url || 'No connection saved'

  if (opencode.code === 'unconfigured') {
    return { ...base, tone: 'warn', status: 'Not configured', detail: 'Add an OpenCode connection' }
  }
  if (opencode.code === 'disabled') {
    return {
      ...base,
      tone: 'idle',
      status: 'Off',
      detail: opencode.url || 'Disabled by admin setting',
    }
  }
  if (opencode.reachable) {
    const latency = opencode.latencyMs === undefined ? '' : ` · ${opencode.latencyMs} ms`
    return { ...base, tone: 'ok', status: 'Reachable', detail: `${detail}${latency}` }
  }

  const status =
    opencode.code === 'auth'
      ? 'Auth rejected'
      : opencode.code === 'timeout'
        ? 'Timed out'
        : opencode.code === 'unsupported'
          ? 'Unsupported version'
          : 'Unreachable'
  return {
    ...base,
    tone: opencode.code === 'unsupported' ? 'warn' : 'bad',
    status,
    detail: opencode.error || detail,
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
    : 'Local-only agent'

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
    return { ...base, tone: 'idle', status: 'Stopped', detail: 'Not running from this agent' }
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
    harnessHealth(snapshot.opencode),
    localHealth(snapshot.local),
    relayHealth(snapshot.relay),
    pushHealth(snapshot.push),
    orchestrationHealth(snapshot.controls.orchestration),
  ]
}

export function needsAttention(item: HealthItem): boolean {
  return item.tone === 'warn' || item.tone === 'bad'
}
