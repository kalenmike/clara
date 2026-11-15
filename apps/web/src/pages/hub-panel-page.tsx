import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import {
  PanelApp,
  PanelCapabilitiesProvider,
  PanelRuntimeProvider,
  configurePanelApi,
  createTunnelPanelTransport,
  getPanelSessionToken,
} from '@clara/panel'
import '@clara/panel/styles/globals.css'
import '@clara/panel/styles/shell.css'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { FullWindowShell } from '@/components/layout/full-window-shell'
import {
  clearPendingAdapterLink,
  readPendingAdapterLink,
  type PendingAdapterLink,
} from '@/features/harness/adapter-link'
import type { ClientControl } from '@/lib/client'
import { adapterHostAvailable, desktopAdapterHost } from '@/lib/desktop-adapter-host'
import { hubPanelCapabilities, hubPanelTransport } from '@/lib/hub-panel'
import { useConnection } from '@/providers/connection-provider'

/**
 * The hub panel at `/hub`. It rides the paired E2EE connection and reaches the
 * hub's loopback listener through the typed `/v1/hub-panel` bridge, so it opens
 * no new port. Controls that would cut or retarget that connection stay disabled.
 */
export function HubPanelPage() {
  const { status, config, control } = useConnection()
  const location = useLocation()
  // The panel reads its transport from module state on mount, so the first
  // render waits until this effect has installed it.
  const [configured, setConfigured] = useState<ClientControl | null>(null)
  const stateLink = (location.state as { adapterLink?: PendingAdapterLink } | null)?.adapterLink
  const [initialPairingCode, setInitialPairingCode] = useState<string>()

  useEffect(() => {
    const link = stateLink ?? readPendingAdapterLink()
    clearPendingAdapterLink()
    if (link) setInitialPairingCode(link.code)
  }, [stateLink])

  useEffect(() => {
    if (!control) return
    configurePanelApi(
      createTunnelPanelTransport({
        // The panel API describes requests as paths; the tunnel fetch takes a URL
        // on the same origin the Clara API client already uses.
        fetch: (path, init) => control.fetch(new URL(path, 'http://clara.api').toString(), init),
        getToken: getPanelSessionToken,
      })
    )
    setConfigured(control)
    return () => {
      configurePanelApi(null)
    }
  }, [control])

  const transport = hubPanelTransport(config?.room)
  const capabilities = useMemo(() => hubPanelCapabilities(transport), [transport])

  // The shell gates the connection; once it is up, wait for this effect to
  // install the panel transport before mounting the panel.
  if (status === 'connected' && (!control || configured !== control)) {
    return <ConnectionSplash label="Opening the hub panel…" />
  }

  return (
    <FullWindowShell>
      <div className="panel-root min-h-0 flex-1">
        <PanelRuntimeProvider
          {...(adapterHostAvailable() ? { adapterHost: desktopAdapterHost } : {})}
          defaultTransport={transport}
        >
          <PanelCapabilitiesProvider capabilities={capabilities}>
            <PanelApp {...(initialPairingCode ? { initialPairingCode } : {})} />
          </PanelCapabilitiesProvider>
        </PanelRuntimeProvider>
      </div>
    </FullWindowShell>
  )
}
