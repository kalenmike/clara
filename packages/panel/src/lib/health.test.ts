import { describe, expect, it } from 'vitest'
import type {
  PanelAgentInfo,
  PanelHarnessState,
  PanelLocalTransport,
  PanelOrchestrationControl,
  PanelPushInfo,
  PanelRelayTransport,
  PanelStorageEntry,
} from '@clara/shared-types'
import {
  buildHealth,
  harnessHealth,
  hubHealth,
  localHealth,
  orchestrationHealth,
  overviewHealth,
  pushHealth,
  relayHealth,
  storageHealth,
} from './health.ts'

function agent(patch: Partial<PanelAgentInfo> = {}): PanelAgentInfo {
  return {
    version: '0.1.0',
    protocol: 12,
    startedAt: '2026-01-01T00:00:00.000Z',
    uptimeMs: 60_000,
    pid: 4242,
    node: 'v22.0.0',
    platform: 'linux',
    arch: 'x64',
    memoryRssBytes: 128 * 1024 * 1024,
    configPath: '/tmp/clara/server.json',
    configDir: '/tmp/clara',
    pairedDevices: 1,
    stopped: false,
    container: false,
    ...patch,
  }
}

function harnessState(patch: Partial<PanelHarnessState> = {}): PanelHarnessState {
  return {
    configured: true,
    paired: 2,
    online: 2,
    desired: true,
    effective: true,
    ...patch,
  }
}

function local(patch: Partial<PanelLocalTransport> = {}): PanelLocalTransport {
  return {
    host: '127.0.0.1',
    port: 8788,
    url: 'ws://127.0.0.1:8788',
    connections: 0,
    desired: true,
    active: true,
    effective: true,
    ...patch,
  }
}

function relay(patch: Partial<PanelRelayTransport> = {}): PanelRelayTransport {
  return {
    configured: true,
    url: 'wss://relay.example',
    room: 'room-1',
    status: 'online',
    desired: true,
    effective: true,
    agentTokenConfigured: true,
    ...patch,
  }
}

function push(patch: Partial<PanelPushInfo> = {}): PanelPushInfo {
  return {
    enabled: true,
    desired: true,
    effective: true,
    subscriptions: 2,
    failing: 0,
    vapidConfigured: true,
    storageAvailable: true,
    ...patch,
  }
}

function orchestration(patch: Partial<PanelOrchestrationControl> = {}): PanelOrchestrationControl {
  return {
    desired: true,
    effective: true,
    state: 'local',
    url: 'http://127.0.0.1:8791',
    ...patch,
  }
}

function storage(status: PanelStorageEntry['status']): PanelStorageEntry {
  return {
    key: 'config',
    label: 'Config',
    path: '/tmp/config.json',
    exists: status !== 'missing',
    writable: true,
    status,
  }
}

describe('harnessHealth', () => {
  it('counts paired and online harnesses', () => {
    const item = harnessHealth(harnessState({ paired: 3, online: 2 }))
    expect(item.tone).toBe('ok')
    expect(item.status).toBe('2 of 3 online')
  })

  it('separates no paired harness from all offline', () => {
    expect(harnessHealth(harnessState({ paired: 0, online: 0 }))).toMatchObject({
      tone: 'warn',
      status: 'Not configured',
    })
    expect(harnessHealth(harnessState({ paired: 2, online: 0 }))).toMatchObject({
      tone: 'warn',
      status: 'All offline',
    })
  })

  it('keeps a disabled harness idle', () => {
    expect(harnessHealth(harnessState({ effective: false, desired: false }))).toMatchObject({
      tone: 'idle',
      status: 'Disabled',
    })
  })
})

describe('localHealth', () => {
  it('counts socket connections while listening', () => {
    const item = localHealth(local({ connections: 3 }))
    expect(item.tone).toBe('ok')
    expect(item.detail).toContain('3 socket connections')
  })

  it('marks a desired but unavailable listener as bad', () => {
    expect(localHealth(local({ active: false, error: 'EADDRINUSE' }))).toMatchObject({
      tone: 'bad',
      detail: 'EADDRINUSE',
    })
  })

  it('keeps a disabled transport idle', () => {
    expect(localHealth(local({ desired: false, active: false })).tone).toBe('idle')
  })
})

describe('relayHealth', () => {
  it('maps relay states to readable tones', () => {
    expect(relayHealth(relay()).tone).toBe('ok')
    expect(relayHealth(relay({ status: 'reconnecting' })).tone).toBe('warn')
    expect(relayHealth(relay({ status: 'offline' })).tone).toBe('bad')
    expect(relayHealth(relay({ status: 'disabled', desired: false })).tone).toBe('idle')
  })

  it('calls out a local-only hub', () => {
    expect(relayHealth(relay({ status: 'disabled', configured: false })).status).toBe(
      'Not configured'
    )
  })
})

describe('pushHealth', () => {
  it('warns about failing deliveries', () => {
    expect(pushHealth(push({ failing: 2 }))).toMatchObject({
      tone: 'warn',
      status: 'Degraded',
    })
  })

  it('treats a reported error as bad and a disabled feature as idle', () => {
    expect(pushHealth(push({ error: 'VAPID missing' })).tone).toBe('bad')
    expect(pushHealth(push({ desired: false, effective: false })).tone).toBe('idle')
  })

  it('keeps storage failures separate from a missing VAPID key', () => {
    const result = pushHealth(push({ storageAvailable: false, storageError: 'EACCES' }))
    expect(result).toMatchObject({ tone: 'warn', status: 'Storage error', detail: 'EACCES' })
  })
})

describe('orchestrationHealth', () => {
  it('reports a healthy local service', () => {
    expect(orchestrationHealth(orchestration())).toMatchObject({
      tone: 'ok',
      status: 'Running',
    })
  })

  it('flags a port conflict and keeps a stopped service idle', () => {
    expect(orchestrationHealth(orchestration({ effective: false, state: 'foreign' })).tone).toBe(
      'bad'
    )
    expect(orchestrationHealth(orchestration({ effective: false, state: 'stopped' })).tone).toBe(
      'idle'
    )
  })
})

describe('storageHealth', () => {
  it('counts errors and warnings independently', () => {
    const result = storageHealth([
      storage('ok'),
      storage('warn'),
      storage('missing'),
      storage('error'),
    ])
    expect(result.tone).toBe('bad')
    expect(result.errors).toBe(1)
    expect(result.warnings).toBe(2)
  })

  it('stays idle when nothing was reported', () => {
    expect(storageHealth([])).toMatchObject({ tone: 'idle', label: 'No entries' })
  })
})

describe('hubHealth', () => {
  it('summarizes an active hub with its platform, process, and version', () => {
    const item = hubHealth(agent())
    expect(item).toMatchObject({
      key: 'hub',
      label: 'Hub',
      tab: 'settings',
      tone: 'ok',
      status: 'Connections active',
    })
    expect(item.detail).toContain('linux/x64')
    expect(item.detail).toContain('pid 4242')
    expect(item.detail).toContain('v0.1.0')
  })

  it('keeps an offline hub idle and names the container process', () => {
    const item = hubHealth(agent({ stopped: true, container: true }))
    expect(item).toMatchObject({ tone: 'idle', status: 'Connections inactive' })
    expect(item.detail).toContain('container')
  })
})

describe('buildHealth', () => {
  it('returns one item for each health surface', () => {
    const snapshot = {
      harness: harnessState(),
      local: local(),
      relay: relay(),
      push: push(),
      controls: {
        stopped: false,
        features: [],
        monitoring: { enabled: true },
        sync: { enabled: true, intervalMs: 30_000 },
        orchestration: orchestration(),
      },
      storage: [storage('ok')],
    } as unknown as Parameters<typeof buildHealth>[0]

    expect(buildHealth(snapshot).map((item) => item.key)).toEqual([
      'harness',
      'local',
      'relay',
      'push',
      'orchestration',
    ])
  })
})

describe('overviewHealth', () => {
  it('leads with the hub and orders the overview strip', () => {
    const snapshot = {
      agent: agent(),
      harness: harnessState(),
      local: local(),
      relay: relay(),
      push: push(),
      controls: {
        stopped: false,
        features: [],
        monitoring: { enabled: true },
        sync: { enabled: true, intervalMs: 30_000 },
        orchestration: orchestration(),
      },
    } as unknown as Parameters<typeof overviewHealth>[0]

    expect(overviewHealth(snapshot).map((item) => item.key)).toEqual([
      'hub',
      'local',
      'relay',
      'harness',
      'push',
      'orchestration',
    ])
  })
})
