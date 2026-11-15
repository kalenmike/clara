import { beforeAll, describe, expect, it } from 'vitest'
import {
  HIDDEN_MODELS_KEY,
  emptyHiddenModels,
  filterModelsByPrice,
  formatPricePerMillion,
  hiddenModelsFor,
  isFreeModel,
  isModelHidden,
  isModelVisible,
  isProviderHidden,
  normalizeHiddenModels,
  parseHiddenModels,
  providerDisplayName,
  readHiddenModels,
  resolveInheritedModel,
  saveHiddenModels,
  withModelHidden,
  withProviderHidden,
  type HiddenModelsState,
} from './visibility'

const storage = new Map<string, string>()
const windowListeners = new Set<(event: StorageEvent) => void>()

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
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === 'storage') windowListeners.add(listener)
      },
      removeEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === 'storage') windowListeners.delete(listener)
      },
    },
  })
})

describe('hidden model storage', () => {
  it('falls back to no harness groups for missing or v1 values', () => {
    expect(parseHiddenModels(null)).toEqual({ version: 2, harnesses: {} })
    expect(parseHiddenModels('{')).toEqual({ version: 2, harnesses: {} })
    expect(parseHiddenModels('[1,2]')).toEqual({ version: 2, harnesses: {} })
    expect(parseHiddenModels('{"providers":["opencode"],"models":[]}')).toEqual({
      version: 2,
      harnesses: {},
    })
  })

  it('normalizes and deduplicates groups per harness', () => {
    expect(
      normalizeHiddenModels({
        version: 2,
        harnesses: {
          ' harness-a ': {
            providers: [' opencode ', 'opencode', 3],
            models: ['opencode/model', '', 'opencode/model'],
          },
        },
      })
    ).toEqual({
      version: 2,
      harnesses: {
        'harness-a': { providers: ['opencode'], models: ['opencode/model'] },
      },
    })
  })

  it('round trips per-harness groups through local storage', () => {
    storage.clear()
    saveHiddenModels({
      version: 2,
      harnesses: {
        'harness-a': { providers: ['opencode'], models: ['openai/gpt-5'] },
      },
    })

    expect(readHiddenModels()).toEqual({
      version: 2,
      harnesses: {
        'harness-a': { providers: ['opencode'], models: ['openai/gpt-5'] },
      },
    })
    expect(storage.get(HIDDEN_MODELS_KEY)).toBe(
      JSON.stringify({
        version: 2,
        harnesses: {
          'harness-a': { providers: ['opencode'], models: ['openai/gpt-5'] },
        },
      })
    )

    saveHiddenModels({ version: 2, harnesses: {} })
    expect(storage.has(HIDDEN_MODELS_KEY)).toBe(false)
  })

  it('keeps visibility separate per harness', () => {
    const state: HiddenModelsState = {
      version: 2,
      harnesses: { 'harness-a': { providers: ['opencode'], models: [] } },
    }
    expect(hiddenModelsFor(state, 'harness-a')).toEqual({
      providers: ['opencode'],
      models: [],
    })
    expect(hiddenModelsFor(state, 'harness-b')).toEqual(emptyHiddenModels())
  })
})

describe('provider labels', () => {
  it('shows the provider product name instead of the host-prefixed server name', () => {
    expect(providerDisplayName('opencode', 'Goose / OpenCode')).toBe('OpenCode')
    expect(providerDisplayName('opencode-go', 'OpenCode Go')).toBe('OpenCode Go')
  })

  it('falls back to the provider ID when no name is available', () => {
    expect(providerDisplayName('custom', '  ')).toBe('custom')
  })
})

describe('hidden model rules', () => {
  it('hides every model when the provider is hidden', () => {
    const visibility = { providers: ['opencode'], models: [] }
    expect(isProviderHidden(visibility, 'opencode')).toBe(true)
    expect(isModelHidden(visibility, 'opencode', 'free')).toBe(true)
  })

  it('hides only the selected model when a provider is visible', () => {
    const visibility = { providers: [], models: ['openai/gpt-5'] }
    expect(isModelHidden(visibility, 'openai', 'gpt-5')).toBe(true)
    expect(isModelHidden(visibility, 'openai', 'gpt-4')).toBe(false)
  })

  it('keeps model choices when a provider is toggled off and on', () => {
    const empty: HiddenModelsState = { version: 2, harnesses: {} }
    const hidden = withModelHidden(empty, 'harness-a', 'openai', 'gpt-5', true)
    const providerOff = withProviderHidden(hidden, 'harness-a', 'openai', true)
    const providerOn = withProviderHidden(providerOff, 'harness-a', 'openai', false)

    expect(hiddenModelsFor(providerOn, 'harness-a').providers).toEqual([])
    expect(hiddenModelsFor(providerOn, 'harness-a').models).toEqual(['openai/gpt-5'])
  })

  it('treats server-disabled models as not visible', () => {
    const visibility = { providers: [], models: [] }
    expect(
      isModelVisible({ providerID: 'opencode', modelID: 'free', enabled: false }, visibility)
    ).toBe(false)
  })

  it('drops a hidden model when inheriting a session model', () => {
    const visibility = { providers: ['opencode'], models: [] }
    expect(
      resolveInheritedModel({ id: 'free', providerID: 'opencode' }, visibility)
    ).toBeUndefined()
    expect(resolveInheritedModel({ id: 'paid', providerID: 'openai' }, visibility)).toEqual({
      id: 'paid',
      providerID: 'openai',
    })
  })
})

describe('model pricing', () => {
  it('treats missing and all-zero costs as free', () => {
    expect(isFreeModel({ cost: [] })).toBe(true)
    expect(isFreeModel({ cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] })).toBe(
      true
    )
  })

  it('treats any positive tier as paid', () => {
    expect(
      isFreeModel({
        cost: [
          { input: 0, output: 0, cache: { read: 0, write: 0 } },
          { input: 0.5, output: 0, cache: { read: 0, write: 0 } },
        ],
      })
    ).toBe(false)
    expect(isFreeModel({ cost: [{ input: 0, output: 0, cache: { read: 0.1, write: 0 } }] })).toBe(
      false
    )
  })

  it('filters models by price', () => {
    const free = { cost: [] }
    const paid = { cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }] }
    expect(filterModelsByPrice([free, paid], 'all')).toEqual([free, paid])
    expect(filterModelsByPrice([free, paid], 'free')).toEqual([free])
    expect(filterModelsByPrice([free, paid], 'paid')).toEqual([paid])
  })

  it('formats per-million prices without trailing zeros', () => {
    expect(formatPricePerMillion(0)).toBe('$0')
    expect(formatPricePerMillion(0.0005)).toBe('$0.0005')
    expect(formatPricePerMillion(0.3)).toBe('$0.3')
    expect(formatPricePerMillion(3)).toBe('$3')
    expect(formatPricePerMillion(12.5)).toBe('$12.5')
  })
})
