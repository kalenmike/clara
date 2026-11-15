import { beforeAll, describe, expect, it } from 'vitest'
import { HIDDEN_MODELS_KEY, readHiddenModels, saveHiddenModels } from '@/features/models/visibility'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  readNotificationSettings,
  saveNotificationSettings,
} from '@/features/notifications/settings'
import {
  ORCHESTRATOR_MODE_KEY,
  readOrchestratorMode,
  saveOrchestratorMode,
} from '@/features/orchestration/client-mode'
import { buildStandaloneSyncFields, buildSyncFields } from './fields'

const storage = new Map<string, string>()

beforeAll(() => {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })
})

describe('hidden models sync field', () => {
  it('shares per-harness groups as one value', () => {
    storage.clear()
    saveHiddenModels({
      version: 2,
      harnesses: {
        'harness-a': { providers: ['opencode'], models: ['openai/gpt-5'] },
      },
    })

    const field = buildSyncFields().models.find((item) => item.key === HIDDEN_MODELS_KEY)
    expect(field).toBeDefined()
    expect(JSON.parse(field!.read() as string)).toEqual({
      version: 2,
      harnesses: {
        'harness-a': { providers: ['opencode'], models: ['openai/gpt-5'] },
      },
    })

    expect(
      field!.apply(
        JSON.stringify({
          version: 2,
          harnesses: { 'harness-b': { providers: ['anthropic'], models: [] } },
        })
      )
    ).toBe(true)
    expect(readHiddenModels()).toEqual({
      version: 2,
      harnesses: { 'harness-b': { providers: ['anthropic'], models: [] } },
    })
  })

  it('rejects v1 and malformed snapshots', () => {
    storage.clear()
    const field = buildSyncFields().models.find((item) => item.key === HIDDEN_MODELS_KEY)

    expect(field!.apply('{}')).toBe(false)
    expect(field!.apply('[]')).toBe(false)
    expect(field!.apply('{')).toBe(false)
    expect(field!.apply(JSON.stringify({ providers: ['opencode'], models: [] }))).toBe(false)
  })
})

describe('orchestrator mode standalone field', () => {
  it('shares only the single client choice', () => {
    storage.clear()
    saveOrchestratorMode(true)

    const field = buildStandaloneSyncFields().orchestratorMode
    expect(field.key).toBe(ORCHESTRATOR_MODE_KEY)
    expect(field.read()).toBe('on')

    expect(field.apply('off')).toBe(true)
    expect(readOrchestratorMode()).toBe(false)

    expect(field.apply('not-a-mode')).toBe(false)
    expect(readOrchestratorMode()).toBe(false)
  })
})

describe('notification sync field', () => {
  it('shares sound preferences without device push or desktop state', () => {
    storage.clear()
    saveNotificationSettings({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      desktop: true,
      push: true,
      sounds: false,
    })

    const field = buildSyncFields().notifications[0]
    const value = field.read()
    expect(value).not.toBeNull()
    const shared = JSON.parse(value as string) as Record<string, unknown>
    expect(shared.sounds).toBe(false)
    expect(shared).not.toHaveProperty('push')
    expect(shared).not.toHaveProperty('desktop')

    expect(field.apply(JSON.stringify({ sounds: true, volume: 0.3 }))).toBe(true)

    const local = readNotificationSettings()
    expect(local.sounds).toBe(true)
    expect(local.volume).toBe(0.3)
    expect(local.push).toBe(true)
    expect(local.desktop).toBe(true)
  })

  it('leaves the device fields untouched when a server subset arrives', () => {
    storage.clear()
    saveNotificationSettings({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      desktop: true,
      push: true,
      uiSounds: true,
    })

    const field = buildSyncFields().notifications[0]
    expect(field.apply(JSON.stringify({ uiSounds: false, soundKinds: { review: false } }))).toBe(
      true
    )

    const local = readNotificationSettings()
    expect(local.uiSounds).toBe(false)
    expect(local.soundKinds.review).toBe(false)
    expect(local.push).toBe(true)
    expect(local.desktop).toBe(true)
  })
})
