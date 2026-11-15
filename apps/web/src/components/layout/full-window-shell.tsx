import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { AppHeader } from '@/components/layout/app-header'
import { useConnection } from '@/providers/connection-provider'

/**
 * Frame for a destination that replaces the project sidebar instead of sitting
 * inside it. It keeps the fixed header and its section tabs, takes the viewport
 * height, and leaves the remaining slot to the surface: the Activity and
 * Settings pages fill it with a scrolling page, while the panel and lab mount
 * their own flex roots.
 */
export function FullWindowShell({ children }: { children: ReactNode }) {
  const { status, booting } = useConnection()
  const location = useLocation()

  if (booting) return <ConnectionSplash label="Checking connection…" />
  if (status === 'connecting') return <ConnectionSplash label="Connecting to the hub…" />
  if (status !== 'connected') {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <AppHeader />
      {children}
    </div>
  )
}
