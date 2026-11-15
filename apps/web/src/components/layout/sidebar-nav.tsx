import { Link, useLocation } from 'react-router'
import { Activity, FlaskConical, Settings, ShieldCheck, type LucideIcon } from 'lucide-react'
import { isDesktop } from '@/lib/runtime'
import { cn } from '@/lib/utils'

/**
 * The sidebar's icon nav. Items share the row evenly, so adding a destination
 * is one entry here and every column re-balances on its own.
 */
type SidebarNavItem = {
  key: string
  to: string
  label: string
  icon: LucideIcon
  /** Matched against `location.pathname` to mark the current page. */
  active: (pathname: string) => boolean
  /** Routed only where the surface exists (Clara Lab needs the desktop shell). */
  desktopOnly?: boolean
}

const NAV_ITEMS: SidebarNavItem[] = [
  {
    key: 'admin',
    to: '/hub',
    label: 'Admin',
    icon: ShieldCheck,
    active: (pathname) => pathname.startsWith('/hub'),
  },
  {
    key: 'lab',
    to: '/lab',
    label: 'Lab',
    icon: FlaskConical,
    active: (pathname) => pathname.startsWith('/lab'),
    desktopOnly: true,
  },
  {
    key: 'activity',
    to: '/activity',
    label: 'Activity',
    icon: Activity,
    active: (pathname) => pathname.startsWith('/activity'),
  },
  {
    key: 'settings',
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    active: (pathname) => pathname.startsWith('/settings'),
  },
]

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()

  const items = NAV_ITEMS.filter((item) => !item.desktopOnly || isDesktop).map((item) =>
    // Settings doubles as the way back out, so the tab you are on leads home.
    item.key === 'settings' && item.active(pathname)
      ? { ...item, to: '/', label: 'Back to home' }
      : item
  )

  return (
    <nav aria-label="Main" className="shrink-0 border-t px-2 py-1.5">
      <div className="flex items-center">
        {items.map((item) => {
          const current = item.active(pathname)
          return (
            <Link
              key={item.key}
              to={item.to}
              onClick={onNavigate}
              title={item.label}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-11 min-w-0 flex-1 items-center justify-center rounded-md transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'md:h-9',
                current
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
              )}
            >
              <item.icon className="size-5 md:size-4" />
              <span className="sr-only">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
