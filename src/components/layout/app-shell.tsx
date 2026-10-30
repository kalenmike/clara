import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Loader2, Menu, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Sidebar, SidebarContent } from '@/components/layout/sidebar'
import { useConnection } from '@/providers/connection-provider'

export function AppShell() {
  const { status } = useConnection()
  const location = useLocation()
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
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Projects and sessions</SheetDescription>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="size-4" />
            <span className="sr-only">Open navigation</span>
          </Button>
          <span className="text-sm font-semibold">Clara</span>
        </div>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
