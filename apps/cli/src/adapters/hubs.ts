import type { AdapterListEntry } from '../commands/adapters.ts'
import type { AdapterEndpoints, AdapterHubStatus } from './live.ts'

/** One hub connection as reported by the adapters on this machine. */
export type AdapterHubLink = {
  url: string
  status: AdapterHubStatus
  connected: boolean
  authenticated: boolean
  lastFrameAt?: number
  lastError?: string
  version?: string
  room?: string
  endpoints: AdapterEndpoints
  adapters: string[]
  updatedAt?: number
}

/** Group adapter live state by hub URL so one hub host is shown once. */
export function adapterHubLinks(entries: readonly AdapterListEntry[]): AdapterHubLink[] {
  const links = new Map<string, AdapterHubLink>()
  for (const entry of entries) {
    const live = entry.live
    if (!live) continue
    // A stopped adapter keeps its last state; do not report that link as live.
    const active = entry.state !== 'stopped'
    const status = active ? live.hub.status : 'stopped'
    const connected = active && live.hub.connected
    const authenticated = active && live.hub.authenticated
    const existing = links.get(live.hub.url)
    if (!existing) {
      links.set(live.hub.url, {
        url: live.hub.url,
        status,
        connected,
        authenticated,
        ...(live.hub.lastFrameAt ? { lastFrameAt: live.hub.lastFrameAt } : {}),
        ...(live.hub.lastError ? { lastError: live.hub.lastError } : {}),
        ...(live.hubInfo?.version ? { version: live.hubInfo.version } : {}),
        ...(live.hubInfo?.room ? { room: live.hubInfo.room } : {}),
        endpoints: { ...(live.hubInfo?.endpoints ?? {}) },
        adapters: [entry.kind],
        ...(live.hubInfo?.updatedAt ? { updatedAt: live.hubInfo.updatedAt } : {}),
      })
      continue
    }

    existing.adapters.push(entry.kind)
    existing.connected ||= connected
    existing.authenticated ||= authenticated
    if (rank(status) > rank(existing.status)) existing.status = status
    if (live.hub.lastFrameAt && live.hub.lastFrameAt > (existing.lastFrameAt ?? 0)) {
      existing.lastFrameAt = live.hub.lastFrameAt
    }
    if (!existing.lastError && live.hub.lastError) existing.lastError = live.hub.lastError
    if (!existing.version && live.hubInfo?.version) existing.version = live.hubInfo.version
    if (!existing.room && live.hubInfo?.room) existing.room = live.hubInfo.room
    if (live.hubInfo?.endpoints) Object.assign(existing.endpoints, live.hubInfo.endpoints)
    if (live.hubInfo?.updatedAt && live.hubInfo.updatedAt > (existing.updatedAt ?? 0)) {
      existing.updatedAt = live.hubInfo.updatedAt
    }
  }

  for (const link of links.values()) {
    if (link.authenticated) delete link.lastError
  }
  return [...links.values()]
}

function rank(status: AdapterHubStatus): number {
  if (status === 'authenticated') return 4
  if (status === 'connected') return 3
  if (status === 'connecting') return 2
  if (status === 'offline') return 1
  return 0
}
