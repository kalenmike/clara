import { describe, expect, it } from 'vitest'
import type { SyncSnapshot } from '@clara/shared-types'
import type { SyncRequestAction, SyncResponse } from '@/lib/transport/relay'
import { SettingsSyncEngine, type SettingsSyncStatus } from './engine'
import type { SyncField, SyncFieldGroups, SyncStandaloneFields } from './fields'
import type { SyncPreferences } from './preferences'

type TestField = SyncField & { get: () => string | null; set: (value: string | null) => void }

function testField(key: string, value: string | null): TestField {
  let current = value
  return {
    key,
    read: () => current,
    apply: (next) => {
      current = next
      return true
    },
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

function createHarness(initial?: Partial<SyncPreferences>, options?: { disabled?: boolean }) {
  const fields: SyncFieldGroups = {
    theme: [testField('clara.colorTheme', null)],
    preferences: [testField('clara.lastAgent', null)],
    models: [testField('clara.hiddenModels', null)],
    notifications: [testField('clara.notifications', null)],
    project: [testField('clara.lastProject', null)],
    inbox: [testField('clara.monitorInbox', null)],
  }
  const standaloneFields: SyncStandaloneFields = {
    orchestratorMode: testField('clara.orchestratorMode', null),
  }

  let preferences: SyncPreferences = {
    categories: {
      theme: false,
      preferences: false,
      models: false,
      notifications: false,
      project: false,
      inbox: false,
    },
    standalone: {
      orchestratorMode: false,
    },
    revision: null,
    dirty: [],
    ...initial,
    ...(initial?.categories ? { categories: { ...initial.categories } } : {}),
    ...(initial?.standalone ? { standalone: { ...initial.standalone } } : {}),
  }

  let server: SyncSnapshot = { namespace: 'default', revision: 0, entries: [] }
  const calls: SyncRequestAction[] = []
  let status: SettingsSyncStatus = { syncing: false, lastSyncedAt: null, error: null }

  const request = async (action: SyncRequestAction): Promise<SyncResponse> => {
    calls.push(action)
    if (options?.disabled) {
      return { type: 'error', code: 'disabled', message: 'disabled' }
    }

    if (action.type === 'sync.check') {
      return { type: 'revision', namespace: server.namespace, revision: server.revision }
    }

    if (action.type === 'sync.pull') {
      return { type: 'snapshot', snapshot: cloneSnapshot(server) }
    }

    if (action.type === 'sync.push') {
      if (action.baseRevision !== undefined && action.baseRevision !== server.revision) {
        return {
          type: 'error',
          code: 'conflict',
          message: 'conflict',
          snapshot: cloneSnapshot(server),
        }
      }

      const values = new Map(
        server.entries
          .filter((entry) => entry.value !== null)
          .map((entry) => [entry.key, entry.value as string])
      )
      for (const entry of action.entries) values.set(entry.key, entry.value as string)
      server = {
        namespace: server.namespace,
        revision: server.revision + 1,
        entries: [...values].map(([key, value]) => ({ key, value, updatedAt: 1 })),
      }
      return { type: 'snapshot', snapshot: cloneSnapshot(server) }
    }

    throw new Error('Unexpected sync action')
  }

  const engine = new SettingsSyncEngine({
    request,
    fields,
    standaloneFields,
    readPreferences: () => preferences,
    writePreferences: (next) => {
      preferences = next
    },
    onStatus: (next) => {
      status = next
    },
    intervalMs: 30_000,
    now: () => 1,
  })

  return {
    engine,
    fields,
    standaloneFields,
    calls,
    preferences: () => preferences,
    status: () => status,
    server: () => server,
    setServer(snapshot: SyncSnapshot) {
      server = cloneSnapshot(snapshot)
    },
    setServerValue(key: string, value: string | null, revision = 1) {
      const entries = server.entries.filter((entry) => entry.key !== key)
      entries.push({ key, value, updatedAt: 1 })
      server = { namespace: server.namespace, revision, entries }
    },
    theme: fields.theme[0] as TestField,
    notifications: fields.notifications[0] as TestField,
    orchestratorMode: standaloneFields.orchestratorMode as TestField,
  }
}

function cloneSnapshot(snapshot: SyncSnapshot): SyncSnapshot {
  return {
    namespace: snapshot.namespace,
    revision: snapshot.revision,
    entries: snapshot.entries.map((entry) => ({ ...entry })),
  }
}

describe('SettingsSyncEngine', () => {
  it('applies an existing server value when a category is enabled', async () => {
    const harness = createHarness()
    harness.theme.set('local')
    harness.setServerValue('clara.colorTheme', 'server')

    await harness.engine.enable('theme')

    expect(harness.theme.get()).toBe('server')
    expect(harness.preferences().categories.theme).toBe(true)
    expect(harness.preferences().revision).toBe(1)
    expect(harness.server().entries).toEqual([
      { key: 'clara.colorTheme', value: 'server', updatedAt: 1 },
    ])
  })

  it('pushes a local-only value when the server has none', async () => {
    const harness = createHarness()
    harness.theme.set('local')

    await harness.engine.enable('theme')

    expect(harness.theme.get()).toBe('local')
    expect(harness.server().entries).toEqual([
      { key: 'clara.colorTheme', value: 'local', updatedAt: 1 },
    ])
    expect(harness.server().revision).toBe(1)
  })

  it('checks the revision and skips the pull when nothing changed', async () => {
    const harness = createHarness({
      categories: {
        theme: true,
        preferences: false,
        models: false,
        notifications: false,
        project: false,
        inbox: false,
      },
      revision: 3,
    })
    harness.setServer({ namespace: 'default', revision: 3, entries: [] })

    await harness.engine.start()
    harness.engine.stop()

    expect(harness.calls.map((call) => call.type)).toEqual(['sync.check'])
  })

  it('pulls and applies server values when the revision changes', async () => {
    const harness = createHarness({
      categories: {
        theme: true,
        preferences: false,
        models: false,
        notifications: false,
        project: false,
        inbox: false,
      },
      revision: 1,
    })
    harness.theme.set('local')
    harness.setServerValue('clara.colorTheme', 'server', 2)

    await harness.engine.start()
    harness.engine.stop()

    expect(harness.calls.map((call) => call.type)).toEqual(['sync.check', 'sync.pull'])
    expect(harness.theme.get()).toBe('server')
    expect(harness.preferences().revision).toBe(2)
  })

  it('pushes dirty local changes before checking', async () => {
    const harness = createHarness({
      categories: {
        theme: true,
        preferences: false,
        models: false,
        notifications: false,
        project: false,
        inbox: false,
      },
      revision: 1,
      dirty: ['clara.colorTheme'],
    })
    harness.theme.set('local')

    await harness.engine.start()
    harness.engine.stop()

    expect(harness.calls[0]?.type).toBe('sync.push')
    expect(harness.server().entries).toEqual([
      { key: 'clara.colorTheme', value: 'local', updatedAt: 1 },
    ])
    expect(harness.preferences().dirty).toEqual([])
  })

  it('discards a conflicting local batch and applies the server snapshot', async () => {
    const harness = createHarness({
      categories: {
        theme: true,
        preferences: false,
        models: false,
        notifications: false,
        project: false,
        inbox: false,
      },
      revision: 1,
      dirty: ['clara.colorTheme'],
    })
    harness.theme.set('local')
    harness.setServerValue('clara.colorTheme', 'server', 2)

    await harness.engine.start()
    harness.engine.stop()

    expect(harness.theme.get()).toBe('server')
    expect(harness.preferences().dirty).toEqual([])
    expect(harness.preferences().revision).toBe(2)
  })

  it('does not apply or push a category that is off', async () => {
    const harness = createHarness({
      categories: {
        theme: true,
        preferences: false,
        models: false,
        notifications: false,
        project: false,
        inbox: false,
      },
      revision: 1,
    })
    harness.theme.set('local')
    harness.notifications.set('local-notifications')
    harness.setServerValue('clara.notifications', 'server-notifications', 2)

    await harness.engine.start()
    harness.engine.stop()

    expect(harness.theme.get()).toBe('local')
    expect(harness.notifications.get()).toBe('local-notifications')
  })

  it('clears dirty keys when a category is disabled', () => {
    const harness = createHarness({
      categories: {
        theme: true,
        preferences: false,
        models: false,
        notifications: false,
        project: false,
        inbox: false,
      },
      revision: 1,
      dirty: ['clara.colorTheme'],
    })

    harness.engine.disable('theme')

    expect(harness.preferences().categories.theme).toBe(false)
    expect(harness.preferences().dirty).toEqual([])
  })

  it('enables one isolated setting without enabling any category', async () => {
    const harness = createHarness()
    harness.orchestratorMode.set('on')

    await harness.engine.enableStandalone('orchestratorMode')

    expect(harness.preferences().standalone.orchestratorMode).toBe(true)
    expect(harness.preferences().categories.theme).toBe(false)
    expect(harness.orchestratorMode.get()).toBe('on')
    expect(harness.server().entries).toEqual([
      { key: 'clara.orchestratorMode', value: 'on', updatedAt: 1 },
    ])
  })

  it('applies a standalone server value and stops syncing it when disabled', async () => {
    const harness = createHarness({
      standalone: { orchestratorMode: true },
      revision: 1,
    })
    harness.orchestratorMode.set('off')
    harness.setServerValue('clara.orchestratorMode', 'on', 2)

    await harness.engine.start()
    harness.engine.stop()

    expect(harness.orchestratorMode.get()).toBe('on')
    expect(harness.preferences().revision).toBe(2)

    harness.engine.disableStandalone('orchestratorMode')
    expect(harness.preferences().standalone.orchestratorMode).toBe(false)
    expect(harness.preferences().dirty).toEqual([])
  })

  it('stops after the server reports sync disabled', async () => {
    const harness = createHarness(
      {
        categories: {
          theme: true,
          preferences: false,
          models: false,
          notifications: false,
          project: false,
          inbox: false,
        },
        revision: 1,
      },
      { disabled: true }
    )

    await harness.engine.start()
    const callsAfterStart = harness.calls.length
    await harness.engine.syncNow()
    harness.engine.stop()

    expect(harness.status().error).toContain('disabled')
    expect(harness.calls.length).toBe(callsAfterStart)
  })
})
