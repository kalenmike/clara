import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Menu } from 'lucide-react'
import { ConnectionSplash } from '@/components/connect/connection-splash'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { MobileActionsProvider, MobileActionsSlot } from '@/components/layout/mobile-actions'
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
    return <ConnectionSplash label="Connecting to OpenCode…" />
  }

  if (status !== 'connected') {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />
  }

  return (
    <InboxMonitorProvider>
      <SettingsSyncProvider>
        <MobileActionsProvider>
          <div className="flex h-full overflow-hidden bg-background text-foreground">
            <Sidebar />

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
                <SheetDescription className="sr-only">Projects and {lowerPlural}</SheetDescription>
                <SidebarContent onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="flex min-w-0 flex-1 flex-col">
              {/* The installed PWA draws under the status bar, so the bar owns the
                top safe-area inset and stays 48px tall below it. */}
              <div className="flex h-[calc(3rem_+_env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b px-3 pt-[env(safe-area-inset-top)] md:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="size-5" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <span className="text-sm font-semibold">Clara</span>
                <MobileActionsSlot />
              </div>
              <UpdateBanner />
              <div className="min-h-0 flex-1">
                <PushProvider>
                  <NotificationProvider>
                    <div className="relative h-full">
                      <Outlet />
                    </div>
                  </NotificationProvider>
                </PushProvider>
              </div>
            </div>
          </div>
        </MobileActionsProvider>
      </SettingsSyncProvider>
    </InboxMonitorProvider>
  )
}
