import { beforeAll, describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_MODE_KEY,
  orchestratorModeActive,
  readOrchestratorMode,
  saveOrchestratorMode,
} from './client-mode'

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
    value: {
      localStorage,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  })
})

describe('orchestrator client mode', () => {
  it('defaults off and stores only this device choice', () => {
    storage.clear()
    saveOrchestratorMode(false)

    expect(readOrchestratorMode()).toBe(false)
    expect(storage.get(ORCHESTRATOR_MODE_KEY)).toBe('off')

    saveOrchestratorMode(true)

    expect(readOrchestratorMode()).toBe(true)
    expect(storage.get(ORCHESTRATOR_MODE_KEY)).toBe('on')
  })

  it('requires both the server gate and the client choice', () => {
    expect(orchestratorModeActive(false, false)).toBe(false)
    expect(orchestratorModeActive(false, true)).toBe(false)
    expect(orchestratorModeActive(true, false)).toBe(false)
    expect(orchestratorModeActive(true, true)).toBe(true)
  })
})
