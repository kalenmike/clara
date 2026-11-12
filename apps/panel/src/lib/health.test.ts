import { describe, expect, it } from 'vitest'
import type {
  PanelLocalTransport,
  PanelOpenCodeInfo,
  PanelOrchestrationControl,
  PanelPushInfo,
  PanelRelayTransport,
  PanelStorageEntry,
} from '@clara/shared-types'
import {
  buildHealth,
  harnessHealth,
  localHealth,
  orchestrationHealth,
  pushHealth,
  relayHealth,
  storageHealth,
} from './health.ts'

function opencode(patch: Partial<PanelOpenCodeInfo> = {}): PanelOpenCodeInfo {
  return {
    url: 'http://127.0.0.1:4096',
    passwordConfigured: true,
    reachable: false,
    desired: true,
    effective: true,
    configured: true,
    checkedAt: '2026-01-01T00:00:00.000Z',
    code: 'unreachable',
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
    clientTokenConfigured: true,
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
    publicKeyConfigured: true,
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
  it('reports a reachable harness with its version and latency', () => {
    const item = harnessHealth(
      opencode({ reachable: true, code: 'ok', version: '2.1.0', latencyMs: 12 })
    )
    expect(item.tone).toBe('ok')
    expect(item.status).toBe('Reachable')
    expect(item.detail).toContain('OpenCode 2.1.0')
    expect(item.detail).toContain('12 ms')
  })

  it('separates a missing connection from a rejected password', () => {
    expect(harnessHealth(opencode({ code: 'unconfigured' })).tone).toBe('warn')
    expect(harnessHealth(opencode({ code: 'auth' }))).toMatchObject({
      tone: 'bad',
      status: 'Auth rejected',
    })
  })

  it('keeps a disabled harness idle', () => {
    expect(harnessHealth(opencode({ code: 'disabled', desired: false })).tone).toBe('idle')
  })

  it('distinguishes an offline adapter from an unreachable harness', () => {
    expect(harnessHealth(opencode({ code: 'offline', reachable: false }))).toMatchObject({
      tone: 'warn',
      status: 'Adapter offline',
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

describe('buildHealth', () => {
  it('returns one item for each health surface', () => {
    const snapshot = {
      opencode: opencode({ reachable: true, code: 'ok' }),
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
