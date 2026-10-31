import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Loader2, Menu, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { MobileActionsProvider, MobileActionsSlot } from '@/components/layout/mobile-actions'
import { Sidebar, SidebarContent } from '@/components/layout/sidebar'
import { InboxMonitorProvider } from '@/features/sessions/inbox-monitor'
import { useSessionWording } from '@/features/sessions/use-wording'
import { useConnection } from '@/providers/connection-provider'
import { NotificationProvider } from '@/providers/notification-provider'
import { PushProvider } from '@/providers/push-provider'

export function AppShell() {
  const { status } = useConnection()
  const location = useLocation()
  const { lowerPlural } = useSessionWording()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  if (status === 'connecting') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background text-foreground">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-foreground text-background">
          <Sparkles className="size-6" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Connecting to OpenCode…
        </div>
      </div>
    )
  }

  if (status !== 'connected') {
    return <Navigate to="/connect" replace state={{ from: location.pathname }} />
  }

  return (
    <InboxMonitorProvider>
      <MobileActionsProvider>
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
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
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
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
    </InboxMonitorProvider>
  )
}
