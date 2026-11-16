import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeRoot = {
  properties: Map<string, string>
  dataset: Record<string, string>
  style: {
    setProperty: (name: string, value: string) => void
    removeProperty: (name: string) => void
  }
  classList: { contains: (name: string) => boolean }
}

type FakeWindow = {
  localStorage: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
  }
  addEventListener: () => void
  matchMedia: () => { matches: boolean; addEventListener: () => void }
}

let root: FakeRoot
let store: Map<string, string>
let fakeWindow: FakeWindow

const THEME_FILE = {
  schemaVersion: 1,
  name: 'Test theme',
  light: {
    background: '#ffffff',
    foreground: '#111111',
    primary: '#aa0000',
    'primary-foreground': '#ffffff',
  },
  dark: {
    background: '#000000',
    foreground: '#eeeeee',
    primary: '#ff0000',
    'primary-foreground': '#000000',
  },
}

function createRoot(): FakeRoot {
  const properties = new Map<string, string>()
  const dataset: Record<string, string> = {}
  return {
    properties,
    dataset,
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    classList: { contains: () => false },
  }
}

async function loadThemeModule() {
  return import('./color-theme')
}

beforeEach(() => {
  vi.resetModules()
  root = createRoot()
  store = new Map()
  fakeWindow = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    addEventListener: () => undefined,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
  }

  Object.assign(globalThis, {
    document: { documentElement: root },
    window: fakeWindow,
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'window')
})

describe('color theme store', () => {
  it('imports, selects, and applies a custom theme', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(store.has('clara.customThemes')).toBe(true)

    theme.saveColorTheme(result.theme.id)

    expect(store.get('clara.colorTheme')).toBe(result.theme.id)
    expect(root.dataset.theme).toBe(result.theme.id)
    expect(root.properties.get('--background')).toBe('#ffffff')
    expect(root.properties.get('--primary')).toBe('#aa0000')
    expect(theme.readColorThemes().map((option) => option.value)).toContain(result.theme.id)
    expect(theme.readColorThemes()).toHaveLength(9)
  })

  it('applies the dark variant from the stored mode', async () => {
    store.set('clara.theme', 'dark')
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')

    theme.saveColorTheme(result.theme.id)

    expect(root.properties.get('--background')).toBe('#000000')
    expect(root.properties.get('--primary')).toBe('#ff0000')
  })

  it('clears inline tokens when returning to the hardcoded Default', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')

    theme.saveColorTheme(result.theme.id)
    expect(root.properties.size).toBeGreaterThan(0)

    theme.saveColorTheme('default')

    expect(root.properties.size).toBe(0)
    expect(root.dataset.theme).toBe('default')
    expect(theme.readColorTheme()).toBe('default')
  })

  it('falls back to Default when the selected theme is removed', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')

    theme.saveColorTheme(result.theme.id)
    expect(theme.removeCustomTheme(result.theme.id)).toBe(true)

    expect(theme.readColorTheme()).toBe('default')
    expect(store.get('clara.colorTheme')).toBe('default')
    expect(root.properties.size).toBe(0)
  })

  it('rejects invalid imports without changing the catalog', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme({
      ...THEME_FILE,
      light: { ...THEME_FILE.light, background: 'url(https://example.com)' },
    })

    expect(result.ok).toBe(false)
    expect(store.has('clara.customThemes')).toBe(false)
  })
})

describe('theme sync value', () => {
  it('round-trips the custom catalog', async () => {
    const theme = await loadThemeModule()
    expect(theme.readCustomThemesValue()).toBe('{"version":1,"themes":[]}')

    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')
    const value = theme.readCustomThemesValue()
    expect(value).not.toBeNull()

    expect(theme.applyCustomThemesValue(value!)).toBe(true)
    expect(theme.readColorThemes().map((option) => option.value)).toContain(result.theme.id)
  })

  it('applies a catalog from the hub', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')
    const value = theme.readCustomThemesValue()!

    vi.resetModules()
    store.delete('clara.customThemes')
    const fresh = await loadThemeModule()
    expect(fresh.readColorThemes()).toHaveLength(8)

    expect(fresh.applyCustomThemesValue(value)).toBe(true)
    expect(fresh.readColorThemes()).toHaveLength(9)
  })

  it('rejects an invalid catalog and keeps the local one', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')
    const before = store.get('clara.customThemes')

    expect(theme.applyCustomThemesValue('{"version":1,"themes":[{"id":"nord"}]}')).toBe(false)
    expect(store.get('clara.customThemes')).toBe(before)
  })

  it('keeps the theme id only while the theme exists', async () => {
    const theme = await loadThemeModule()
    const result = theme.importCustomTheme(THEME_FILE)
    if (!result.ok) throw new Error('theme import failed')

    store.set('clara.colorTheme', 'custom-deadbeef')
    expect(theme.readColorThemeValue()).toBe('default')
    expect(theme.applyColorThemeValue(result.theme.id)).toBe(true)
    expect(theme.readColorThemeValue()).toBe(result.theme.id)
    expect(theme.applyColorThemeValue('custom-deadbeef')).toBe(false)
  })
})
