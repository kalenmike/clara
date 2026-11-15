import { Link, useLocation } from 'react-router'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MobileActionsSlot } from '@/components/layout/mobile-actions'
import { visibleAppNavItems, type AppNavItem } from '@/components/layout/app-nav'
import { isDesktop } from '@/lib/runtime'
import { cn } from '@/lib/utils'

/**
 * Fixed chrome for every connected surface. The desktop row pairs the Clara
 * mark with text destinations. Phones get a second, equal-width tab row so the
 * five destinations keep readable labels instead of collapsing to glyphs.
 */
export function AppHeader({
  onOpenNav,
  showMobileActions = false,
}: {
  /** Opens the sidebar drawer. Omitted on full-window surfaces without one. */
  onOpenNav?: () => void
  /** Mounts the chat header's mobile action strip beside the mark. */
  showMobileActions?: boolean
}) {
  const { pathname } = useLocation()
  const items = visibleAppNavItems(isDesktop)

  return (
    <header className="relative z-30 shrink-0 border-b bg-background pt-[var(--safe-top)]">
      <div className="flex h-12 items-center gap-2 px-3 md:px-4">
        {onOpenNav && (
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:hidden"
            onClick={onOpenNav}
            title="Open navigation"
          >
            <Menu className="size-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
        )}

        <Link
          to="/"
          aria-label="Clara home"
          className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src="/clara-mark.png" alt="" className="size-7 shrink-0" />
          <img src="/clara-type.png" alt="Clara" className="hidden h-4 w-auto sm:block" />
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <AppNavLink key={item.key} item={item} pathname={pathname} />
          ))}
        </nav>

        {showMobileActions && (
          <div className="ml-auto md:hidden">
            <MobileActionsSlot />
          </div>
        )}
      </div>

      <nav aria-label="Main" className="flex h-11 items-stretch border-t md:hidden">
        {items.map((item) => (
          <AppNavLink key={item.key} item={item} pathname={pathname} />
        ))}
      </nav>
    </header>
  )
}

function AppNavLink({ item, pathname }: { item: AppNavItem; pathname: string }) {
  const current = item.active(pathname)
  return (
    <Link
      to={item.to}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 items-center justify-center px-1 text-xs font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'md:flex-none md:rounded-md md:px-2.5 md:py-1.5 md:text-sm',
        current
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
