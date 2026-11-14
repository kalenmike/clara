import { createContext, useContext } from 'react'
import type { PanelThemeMode, ResolvedPanelTheme } from './theme.ts'

type PanelThemeContextValue = {
  mode: PanelThemeMode
  resolved: ResolvedPanelTheme
  setMode: (mode: PanelThemeMode) => void
}

export const PanelThemeContext = createContext<PanelThemeContextValue | null>(null)

export function usePanelTheme(): PanelThemeContextValue {
  const value = useContext(PanelThemeContext)
  if (!value) throw new Error('usePanelTheme must be used inside PanelThemeProvider')
  return value
}
