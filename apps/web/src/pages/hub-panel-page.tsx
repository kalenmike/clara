import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router'
import {
  PanelApp,
  PanelCapabilitiesProvider,
  PanelThemeProvider,
  configurePanelApi,
  createTunnelPanelTransport,
  getPanelSessionToken,
} from '@clara/panel'
import '@clara/panel/styles/globals.css'
import '@clara/panel/styles/shell.css'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { Button } from '@/components/ui/button'
import type { ClientControl } from '@/lib/client'
import { hubPanelCapabilities, hubPanelTransport } from '@/lib/hub-panel'
import { useConnection } from '@/providers/connection-provider'

/**
 * The hub panel at `/hub`. It rides the paired E2EE connection and reaches the
 * hub's loopback listener through the typed `/v1/hub-panel` bridge, so it opens
 * no new port. Controls that would cut or retarget that connection stay disabled.
 */
export function HubPanelPage() {
  const { status, booting, config, control } = useConnection()
  const location = useLocation()
  // The panel reads its transport from module state on mount, so the first
  // render waits until this effect has installed it.
  const [configured, setConfigured] = useState<ClientControl | null>(null)

  // The panel theme provider applies its choice to the document element. Keep
  // the app's theme so leaving /hub restores the chat client unchanged.
  const previousTheme = useRef<{ dark: boolean; colorScheme: string } | null>(null)
  if (previousTheme.current === null) {
    previousTheme.current = {
      dark: document.documentElement.classList.contains('dark'),
      colorScheme: document.documentElement.style.colorScheme,
    }
  }

  useEffect(() => {
    return () => {
      const previous = previousTheme.current
      if (!previous) return
      document.documentElement.classList.toggle('dark', previous.dark)
      document.documentElement.style.colorScheme = previous.colorScheme
    }
  }, [])

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

  if (booting) return <ConnectionSplash label="Checking connection…" />
  if (status === 'connecting') return <ConnectionSplash label="Connecting to the hub…" />
  if (status !== 'connected' || !control) {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />
  }
  if (configured !== control) return <ConnectionSplash label="Opening the hub panel…" />

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Clara
          </Link>
        </Button>
        <span className="truncate text-xs text-muted-foreground">Hub panel</span>
      </header>
      <div className="panel-root min-h-0 flex-1">
        <PanelThemeProvider>
          <PanelCapabilitiesProvider capabilities={capabilities}>
            <PanelApp />
          </PanelCapabilitiesProvider>
        </PanelThemeProvider>
      </div>
    </div>
  )
}
