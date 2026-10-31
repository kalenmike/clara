import { useCallback, useSyncExternalStore } from 'react'
import { readColorTheme, saveColorTheme, subscribeColorTheme, type ColorTheme } from './color-theme'

export function useColorTheme() {
  const theme = useSyncExternalStore(subscribeColorTheme, readColorTheme, readColorTheme)

  const setTheme = useCallback((next: ColorTheme) => {
    saveColorTheme(next)
  }, [])

  return { theme, setTheme }
}
