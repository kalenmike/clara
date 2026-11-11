import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PANEL_TAB, panelTabFromHash, type PanelTab } from './tabs.ts'

/**
 * Keeps the active view in the URL hash. The hash survives a reload and makes
 * support links like `#traffic` work without adding a router.
 */
export function usePanelTab(): [PanelTab, (tab: PanelTab) => void] {
  const [tab, setTab] = useState<PanelTab>(() =>
    typeof window === 'undefined' ? DEFAULT_PANEL_TAB : panelTabFromHash(window.location.hash)
  )

  useEffect(() => {
    const sync = () => setTab(panelTabFromHash(window.location.hash))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const select = useCallback((next: PanelTab) => {
    setTab(next)
    if (window.location.hash !== `#${next}`) {
      window.history.replaceState(null, '', `#${next}`)
    }
  }, [])

  return [tab, select]
}
