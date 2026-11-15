import { useMemo, type ReactNode } from 'react'
import {
  DEFAULT_PANEL_RUNTIME,
  PanelRuntimeContext,
  type PanelAdapterHost,
  type PanelRuntime,
} from './runtime-context.ts'

export function PanelRuntimeProvider({
  adapterHost,
  defaultTransport,
  children,
}: {
  adapterHost?: PanelAdapterHost
  defaultTransport?: 'local' | 'relay'
  children: ReactNode
}) {
  const value = useMemo<PanelRuntime>(
    () => ({
      ...(adapterHost ? { adapterHost } : {}),
      defaultTransport: defaultTransport ?? DEFAULT_PANEL_RUNTIME.defaultTransport,
    }),
    [adapterHost, defaultTransport]
  )

  return <PanelRuntimeContext.Provider value={value}>{children}</PanelRuntimeContext.Provider>
}
