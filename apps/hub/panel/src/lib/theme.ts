export const PANEL_THEME_KEY = 'clara.panelTheme'
export const PANEL_SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'
const PANEL_THEME_MODES = ['light', 'dark', 'system'] as const

export type PanelThemeMode = (typeof PANEL_THEME_MODES)[number]
export type ResolvedPanelTheme = 'light' | 'dark'

export function isPanelThemeMode(value: unknown): value is PanelThemeMode {
  return typeof value === 'string' && (PANEL_THEME_MODES as readonly string[]).includes(value)
}

export function readPanelTheme(): PanelThemeMode {
  try {
    const value = window.localStorage.getItem(PANEL_THEME_KEY)
    return isPanelThemeMode(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

export function savePanelTheme(mode: PanelThemeMode): void {
  try {
    window.localStorage.setItem(PANEL_THEME_KEY, mode)
  } catch {
    // The panel still follows the chosen mode for this visit.
  }
}

export function resolvePanelTheme(
  mode: PanelThemeMode,
  systemPrefersDark: boolean
): ResolvedPanelTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PANEL_SYSTEM_THEME_QUERY).matches
}

export function applyPanelTheme(theme: ResolvedPanelTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/** Apply the stored choice before React renders to avoid a flash of the wrong palette. */
export function applyStoredPanelTheme(): void {
  applyPanelTheme(resolvePanelTheme(readPanelTheme(), systemPrefersDark()))
}
