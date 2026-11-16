import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  MAX_CUSTOM_THEMES,
  MAX_THEME_CATALOG_BYTES,
  THEME_TOKEN_NAMES,
  builtInTheme,
  createCustomTheme,
  isCustomThemeId,
  parseCustomThemeCatalog,
  parseThemeFile,
  serializeThemeCatalog,
  themeCatalogBytes,
  type StoredTheme,
  type ThemeParseError,
  type ThemeTokenName,
  type ThemeVariant,
} from '@clara/theme'
import { notifySettingChanged } from '@/lib/setting-events'
import { THEME_KEY } from '@/lib/storage'

export const COLOR_THEME_KEY = 'clara.colorTheme'
export const CUSTOM_THEMES_KEY = 'clara.customThemes'
export const DEFAULT_COLOR_THEME = DEFAULT_THEME_ID
export const MAX_CUSTOM_THEME_COUNT = MAX_CUSTOM_THEMES

export type ColorThemePreview = {
  light: [background: string, primary: string]
  dark: [background: string, primary: string]
}

export type ColorThemeOption = {
  value: string
  label: string
  custom: boolean
  preview: ColorThemePreview
}

export type CustomThemeImportResult =
  { ok: true; theme: StoredTheme } | { ok: false; errors: ThemeParseError[] }

let cachedThemes: StoredTheme[] | null = null
let cachedOptions: ColorThemeOption[] | null = null
let cachedSelection: string | null = null
let appliedTokens: ThemeTokenName[] = []
let currentMode: ThemeVariant | null = null
let modeObserver: MutationObserver | null = null
let storageInstalled = false

const selectionListeners = new Set<() => void>()
const catalogListeners = new Set<() => void>()

export function isColorTheme(value: unknown): value is string {
  return typeof value === 'string' && themeById(value) !== undefined
}

export function readColorTheme(): string {
  if (cachedSelection !== null) return cachedSelection

  const stored = readRaw(COLOR_THEME_KEY)
  cachedSelection = stored !== null && themeById(stored) ? stored : DEFAULT_COLOR_THEME
  return cachedSelection
}

/** The color theme list: the built-in palettes plus this device's imports. */
export function readColorThemes(): ColorThemeOption[] {
  if (cachedOptions) return cachedOptions

  cachedOptions = [...BUILT_IN_THEMES, ...loadCustomThemes()].map((theme) => ({
    value: theme.id,
    label: theme.name,
    custom: builtInTheme(theme.id) === undefined,
    preview: previewOf(theme),
  }))
  return cachedOptions
}

export function applyColorTheme(themeId: string): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const theme = themeById(themeId) ?? builtInTheme(DEFAULT_THEME_ID)
  if (!theme) return

  clearAppliedTokens(root)
  root.dataset.theme = theme.id
  currentMode = resolveMode()

  // Default stays in the stylesheet so the base palette works before this
  // module runs and follows `.dark` without JavaScript.
  if (theme.id === DEFAULT_THEME_ID) return

  const tokens = theme[currentMode]
  for (const name of THEME_TOKEN_NAMES) {
    const value = tokens[name]
    if (!value) continue
    root.style.setProperty(`--${name}`, value)
    appliedTokens.push(name)
  }
}

export function saveColorTheme(theme: string): void {
  const next = themeById(theme) ? theme : DEFAULT_COLOR_THEME
  cachedSelection = next
  writeRaw(COLOR_THEME_KEY, next)
  applyColorTheme(next)
  notifySelection()
  notifySettingChanged(COLOR_THEME_KEY)
}

export function subscribeColorTheme(listener: () => void): () => void {
  installStorageListener()
  selectionListeners.add(listener)
  return () => selectionListeners.delete(listener)
}

export function subscribeColorThemes(listener: () => void): () => void {
  installStorageListener()
  catalogListeners.add(listener)
  return () => catalogListeners.delete(listener)
}

export function initColorTheme(): void {
  applyColorTheme(readColorTheme())
  watchMode()
  installStorageListener()
}

/**
 * Validate and add one uploaded or pasted theme. The caller selects it when it
 * should become active.
 */
export function importCustomTheme(input: unknown): CustomThemeImportResult {
  const parsed = parseThemeFile(input)
  if (!parsed.ok) return parsed

  const themes = loadCustomThemes()
  if (themes.length >= MAX_CUSTOM_THEMES) {
    return {
      ok: false,
      errors: [
        { path: 'themes', message: `You can keep at most ${MAX_CUSTOM_THEMES} custom themes.` },
      ],
    }
  }

  const theme = createCustomTheme(
    parsed.value,
    themes.map((item) => item.id)
  )
  const next = [...themes, theme]
  if (themeCatalogBytes(next) > MAX_THEME_CATALOG_BYTES) {
    return {
      ok: false,
      errors: [{ path: 'theme', message: 'This theme does not fit in the theme list.' }],
    }
  }
  if (!persistCustomThemes(next)) {
    return {
      ok: false,
      errors: [{ path: 'theme', message: 'This browser could not store the theme.' }],
    }
  }
  return { ok: true, theme }
}

export function removeCustomTheme(id: string): boolean {
  if (!isCustomThemeId(id)) return false

  const themes = loadCustomThemes()
  if (!themes.some((theme) => theme.id === id)) return false
  if (!persistCustomThemes(themes.filter((theme) => theme.id !== id))) return false

  if (readRaw(COLOR_THEME_KEY) === id) saveColorTheme(DEFAULT_COLOR_THEME)
  return true
}

/** The synchronized value for the Theme category, or null when unavailable. */
export function readCustomThemesValue(): string | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(CUSTOM_THEMES_KEY)
  } catch {
    return null
  }
  if (raw === null) return serializeThemeCatalog([])

  try {
    const parsed = parseCustomThemeCatalog(JSON.parse(raw))
    return serializeThemeCatalog(parsed.ok ? parsed.value.themes : [])
  } catch {
    return serializeThemeCatalog([])
  }
}

export function applyCustomThemesValue(value: string): boolean {
  let input: unknown
  try {
    input = JSON.parse(value)
  } catch {
    return false
  }

  const parsed = parseCustomThemeCatalog(input)
  if (!parsed.ok) return false
  if (themeCatalogBytes(parsed.value.themes) > MAX_THEME_CATALOG_BYTES) return false
  return persistCustomThemes(parsed.value.themes)
}

/** The selected id for the Theme category, or null when this device has none. */
export function readColorThemeValue(): string | null {
  const stored = readRaw(COLOR_THEME_KEY)
  if (stored === null) return null
  return themeById(stored) ? stored : DEFAULT_COLOR_THEME
}

export function applyColorThemeValue(value: string): boolean {
  if (!themeById(value)) return false
  saveColorTheme(value)
  return true
}

function themeById(id: string): StoredTheme | undefined {
  return builtInTheme(id) ?? loadCustomThemes().find((theme) => theme.id === id)
}

function loadCustomThemes(): StoredTheme[] {
  if (cachedThemes) return cachedThemes

  const raw = readRaw(CUSTOM_THEMES_KEY)
  if (raw === null) {
    cachedThemes = []
    return cachedThemes
  }

  try {
    const parsed = parseCustomThemeCatalog(JSON.parse(raw))
    cachedThemes = parsed.ok ? parsed.value.themes : []
  } catch {
    cachedThemes = []
  }
  return cachedThemes
}

function persistCustomThemes(themes: StoredTheme[]): boolean {
  if (themeCatalogBytes(themes) > MAX_THEME_CATALOG_BYTES) return false
  if (!writeRaw(CUSTOM_THEMES_KEY, serializeThemeCatalog(themes))) return false

  invalidateCatalog()
  applyColorTheme(readColorTheme())
  notifyCatalog()
  notifySelection()
  notifySettingChanged(CUSTOM_THEMES_KEY)
  return true
}

function previewOf(theme: StoredTheme): ColorThemePreview {
  return {
    light: [theme.light.background ?? '#ffffff', theme.light.primary ?? '#343434'],
    dark: [theme.dark.background ?? '#252525', theme.dark.primary ?? '#e5e5e5'],
  }
}

function clearAppliedTokens(root: HTMLElement): void {
  for (const name of appliedTokens) root.style.removeProperty(`--${name}`)
  appliedTokens = []
}

function resolveMode(): ThemeVariant {
  if (document.documentElement.classList.contains('dark')) return 'dark'

  const stored = readRaw(THEME_KEY)
  if (stored === 'dark') return 'dark'
  if (stored === 'light') return 'light'

  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function watchMode(): void {
  if (typeof window === 'undefined' || modeObserver) return

  currentMode = resolveMode()
  modeObserver = new MutationObserver(reapplyForMode)
  modeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })

  if (typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reapplyForMode)
  }
}

function reapplyForMode(): void {
  const mode = resolveMode()
  if (mode === currentMode) return
  currentMode = mode
  if (readColorTheme() !== DEFAULT_THEME_ID) applyColorTheme(readColorTheme())
}

function installStorageListener(): void {
  if (storageInstalled || typeof window === 'undefined') return

  storageInstalled = true
  window.addEventListener('storage', (event) => {
    if (event.key === CUSTOM_THEMES_KEY) {
      invalidateCatalog()
      applyColorTheme(readColorTheme())
      notifyCatalog()
      notifySelection()
      return
    }
    if (event.key === COLOR_THEME_KEY) {
      invalidateSelection()
      applyColorTheme(readColorTheme())
      notifySelection()
    }
  })
}

function invalidateCatalog(): void {
  cachedThemes = null
  cachedOptions = null
  cachedSelection = null
}

function invalidateSelection(): void {
  cachedSelection = null
}

function notifySelection(): void {
  for (const listener of selectionListeners) listener()
}

function notifyCatalog(): void {
  for (const listener of catalogListeners) listener()
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}
