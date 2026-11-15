import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { PanelThemeContext } from './theme-context.ts'
import {
  PANEL_SYSTEM_THEME_QUERY,
  PANEL_THEME_KEY,
  applyPanelTheme,
  readPanelTheme,
  resolvePanelTheme,
  savePanelTheme,
  type PanelThemeMode,
} from './theme.ts'

export function PanelThemeProvider({ children }: { children: ReactNode }) {
  const query = useMemo(() => window.matchMedia(PANEL_SYSTEM_THEME_QUERY), [])
  const [mode, setModeState] = useState<PanelThemeMode>(readPanelTheme)
  const [systemDark, setSystemDark] = useState(() => query.matches)
  const resolved = resolvePanelTheme(mode, systemDark)

  useLayoutEffect(() => {
    applyPanelTheme(resolved)
  }, [resolved])

  useEffect(() => {
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [query])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PANEL_THEME_KEY) setModeState(readPanelTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setMode = useCallback((next: PanelThemeMode) => {
    savePanelTheme(next)
    setModeState(next)
  }, [])

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode])

  return <PanelThemeContext.Provider value={value}>{children}</PanelThemeContext.Provider>
}
