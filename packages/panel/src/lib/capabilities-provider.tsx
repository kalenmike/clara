import { useMemo, type ReactNode } from 'react'
import {
  DEFAULT_PANEL_CAPABILITIES,
  PanelCapabilitiesContext,
  type PanelCapabilities,
} from './capabilities-context.ts'

export function PanelCapabilitiesProvider({
  capabilities,
  children,
}: {
  /** Control areas to disable; omitted areas keep the hub-served default. */
  capabilities?: Partial<PanelCapabilities>
  children: ReactNode
}) {
  const value = useMemo(() => ({ ...DEFAULT_PANEL_CAPABILITIES, ...capabilities }), [capabilities])

  return (
    <PanelCapabilitiesContext.Provider value={value}>{children}</PanelCapabilitiesContext.Provider>
  )
}
