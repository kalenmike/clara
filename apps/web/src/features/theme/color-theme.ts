import { notifySettingChanged } from '@/lib/setting-events'

export const COLOR_THEME_VALUES = [
  'default',
  'solarized',
  'tokyo-night',
  'gruvbox',
  'nord',
  'rose-pine',
  'catppuccin',
  'clara',
] as const

export type ColorTheme = (typeof COLOR_THEME_VALUES)[number]

export type ColorThemePreview = {
  light: [background: string, primary: string]
  dark: [background: string, primary: string]
}

export type ColorThemeOption = {
  value: ColorTheme
  label: string
  preview: ColorThemePreview
}

export const COLOR_THEMES: ColorThemeOption[] = [
  {
    value: 'default',
    label: 'Default',
    preview: {
      light: ['#ffffff', '#343434'],
      dark: ['#252525', '#e5e5e5'],
    },
  },
  {
    value: 'solarized',
    label: 'Solarized',
    preview: {
      light: ['#fdf6e3', '#268bd2'],
      dark: ['#002b36', '#268bd2'],
    },
  },
  {
    value: 'tokyo-night',
    label: 'Tokyo Night',
    preview: {
      light: ['#e1e2e7', '#2e7de9'],
      dark: ['#1a1b26', '#7aa2f7'],
    },
  },
  {
    value: 'gruvbox',
    label: 'Gruvbox',
    preview: {
      light: ['#fbf1c7', '#af3a03'],
      dark: ['#282828', '#fe8019'],
    },
  },
  {
    value: 'nord',
    label: 'Nord',
    preview: {
      light: ['#eceff4', '#5e81ac'],
      dark: ['#2e3440', '#88c0d0'],
    },
  },
  {
    value: 'rose-pine',
    label: 'Rose Pine',
    preview: {
      light: ['#faf4ed', '#286983'],
      dark: ['#191724', '#c4a7e7'],
    },
  },
  {
    value: 'catppuccin',
    label: 'Catppuccin',
    preview: {
      light: ['#eff1f5', '#8839ef'],
      dark: ['#1e1e2e', '#cba6f7'],
    },
  },
  {
    value: 'clara',
    label: 'Clara',
    preview: {
      light: ['#faf7ff', '#a21fd0'],
      dark: ['#101f3b', '#e066ff'],
    },
  },
]

export const DEFAULT_COLOR_THEME: ColorTheme = 'default'
export const COLOR_THEME_KEY = 'clara.colorTheme'

let cached: ColorTheme | null = null
const listeners = new Set<() => void>()

export function isColorTheme(value: unknown): value is ColorTheme {
  return typeof value === 'string' && (COLOR_THEME_VALUES as readonly string[]).includes(value)
}

export function readColorTheme(): ColorTheme {
  if (cached) return cached

  try {
    const stored = window.localStorage.getItem(COLOR_THEME_KEY)
    cached = isColorTheme(stored) ? stored : DEFAULT_COLOR_THEME
  } catch {
    cached = DEFAULT_COLOR_THEME
  }

  return cached
}

export function applyColorTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme
}

export function saveColorTheme(theme: ColorTheme): void {
  cached = isColorTheme(theme) ? theme : DEFAULT_COLOR_THEME

  try {
    window.localStorage.setItem(COLOR_THEME_KEY, cached)
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  applyColorTheme(cached)
  for (const listener of listeners) listener()
  notifySettingChanged(COLOR_THEME_KEY)
}

export function subscribeColorTheme(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLOR_THEME_KEY) return
    cached = null
    applyColorTheme(readColorTheme())
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function initColorTheme(): void {
  applyColorTheme(readColorTheme())
}
