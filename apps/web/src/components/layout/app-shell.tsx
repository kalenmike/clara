import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { AppHeader } from '@/components/layout/app-header'
import { AppStatusBar } from '@/components/layout/app-status-bar'
import { HarnessBanner } from '@/components/layout/harness-banner'
import { MobileActionsProvider } from '@/components/layout/mobile-actions'
import { RouteProgress } from '@/components/layout/route-progress'
import { Sidebar, SidebarContent } from '@/components/layout/sidebar'
import { InboxMonitorProvider } from '@/features/sessions/inbox-monitor'
import { useSessionWording } from '@/features/sessions/use-wording'
import { UpdateBanner } from '@/components/pwa/update-banner'
import { useConnection } from '@/providers/connection-provider'
import { NotificationProvider } from '@/providers/notification-provider'
import { PushProvider } from '@/providers/push-provider'
import { SettingsSyncProvider } from '@/providers/settings-sync-provider'

export function AppShell() {
  const { status } = useConnection()
  const location = useLocation()
  const { lowerPlural } = useSessionWording()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  if (status === 'connecting') {
    return <ConnectionSplash label="Connecting to the hub…" />
  }

  if (status !== 'connected') {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />
  }

  return (
    <InboxMonitorProvider>
      <SettingsSyncProvider>
        <MobileActionsProvider>
          <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <AppHeader onOpenNav={() => setMobileOpen(true)} showMobileActions />

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <Sidebar />

              {/* Full-height sheet: the drawer covers the app header, as the
                  pinned sidebar starts below it. */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                  side="left"
                  className="gap-0 p-0"
                  // Inline width beats the sheet's `data-[side=left]:w-3/4` and leaves a
                  // 44px strip of scrim to tap out, while capping the list on wide phones.
                  style={{ width: 'min(24rem, calc(100vw - 2.75rem))' }}
                  showCloseButton={false}
                >
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <SheetDescription className="sr-only">
                    Projects and {lowerPlural}
                  </SheetDescription>
                  <SidebarContent onNavigate={() => setMobileOpen(false)} scope="drawer" />
                </SheetContent>
              </Sheet>

              <div className="flex min-w-0 flex-1 flex-col">
                <UpdateBanner />
                <HarnessBanner />
                <div className="min-h-0 flex-1">
                  <PushProvider>
                    <NotificationProvider>
                      <div className="relative h-full">
                        <RouteProgress />
                        <Outlet />
                      </div>
                    </NotificationProvider>
                  </PushProvider>
                </div>
              </div>
            </div>

            <AppStatusBar />
          </div>
        </MobileActionsProvider>
      </SettingsSyncProvider>
    </InboxMonitorProvider>
  )
}
