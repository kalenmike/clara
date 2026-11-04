import { beforeAll, describe, expect, it } from 'vitest'
import {
  HIDDEN_MODELS_KEY,
  filterModelsByPrice,
  formatPricePerMillion,
  isFreeModel,
  isModelHidden,
  isModelVisible,
  isProviderHidden,
  normalizeHiddenModels,
  parseHiddenModels,
  readHiddenModels,
  resolveInheritedModel,
  saveHiddenModels,
  withModelHidden,
  withProviderHidden,
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
  it('falls back to an empty group for missing or invalid values', () => {
    expect(parseHiddenModels(null)).toEqual({ providers: [], models: [] })
    expect(parseHiddenModels('{')).toEqual({ providers: [], models: [] })
    expect(parseHiddenModels('[1,2]')).toEqual({ providers: [], models: [] })
  })

  it('normalizes and deduplicates both lists', () => {
    expect(
      normalizeHiddenModels({
        providers: [' opencode ', 'opencode', 3],
        models: ['opencode/model', '', 'opencode/model'],
      })
    ).toEqual({ providers: ['opencode'], models: ['opencode/model'] })
  })

  it('round trips the whole group through local storage', () => {
    storage.clear()
    saveHiddenModels({ providers: ['opencode'], models: ['openai/gpt-5'] })

    expect(readHiddenModels()).toEqual({
      providers: ['opencode'],
      models: ['openai/gpt-5'],
    })
    expect(storage.get(HIDDEN_MODELS_KEY)).toBe(
      JSON.stringify({ providers: ['opencode'], models: ['openai/gpt-5'] })
    )

    saveHiddenModels({ providers: [], models: [] })
    expect(storage.has(HIDDEN_MODELS_KEY)).toBe(false)
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
    const hidden = withModelHidden({ providers: [], models: [] }, 'openai', 'gpt-5', true)
    const providerOff = withProviderHidden(hidden, 'openai', true)
    const providerOn = withProviderHidden(providerOff, 'openai', false)

    expect(providerOn.providers).toEqual([])
    expect(providerOn.models).toEqual(['openai/gpt-5'])
  })

  it('treats server-disabled models as not visible', () => {
    const visibility = { providers: [], models: [] }
    expect(
      isModelVisible(
        { providerID: 'opencode', modelID: 'free', enabled: false },
        visibility
      )
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
    expect(
      isFreeModel({ cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] })
    ).toBe(true)
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
    expect(
      isFreeModel({ cost: [{ input: 0, output: 0, cache: { read: 0.1, write: 0 } }] })
    ).toBe(false)
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
