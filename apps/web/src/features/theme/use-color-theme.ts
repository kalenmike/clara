import { useCallback, useSyncExternalStore } from 'react'
import {
  readColorTheme,
  readColorThemes,
  saveColorTheme,
  subscribeColorTheme,
  subscribeColorThemes,
} from './color-theme'

export function useColorTheme() {
  const theme = useSyncExternalStore(subscribeColorTheme, readColorTheme, readColorTheme)

  const setTheme = useCallback((next: string) => {
    saveColorTheme(next)
  }, [])

  return { theme, setTheme }
}

/** The built-in palettes plus the custom themes stored on this device. */
export function useColorThemes() {
  return useSyncExternalStore(subscribeColorThemes, readColorThemes, readColorThemes)
}
