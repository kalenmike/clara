import { Link, useLocation } from 'react-router'
import { Check, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { visibleAppNavItems, type AppNavItem } from '@/components/layout/app-nav'
import { isDesktop } from '@/lib/runtime'
import { cn } from '@/lib/utils'

/**
 * Fixed chrome for every connected surface. The desktop row pairs the Clara
 * mark with text destinations. Phones keep a single row: the left button opens
 * the project drawer and the right button folds the destinations into a menu,
 * so the header leaves its height to the session below it.
 */
export function AppHeader({
  onOpenNav,
}: {
  /** Opens the sidebar drawer. Omitted on full-window surfaces without one. */
  onOpenNav?: () => void
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-11 md:hidden"
              title="Open main menu"
            >
              <Menu className="size-5" />
              <span className="sr-only">Open main menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {items.map((item) => {
              const current = item.active(pathname)
              return (
                <DropdownMenuItem
                  key={item.key}
                  asChild
                  className={cn('min-h-11', current && 'bg-accent text-accent-foreground')}
                >
                  <Link to={item.to} aria-current={current ? 'page' : undefined}>
                    {item.label}
                    {current && <Check className="ml-auto size-4" />}
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
        'flex min-w-0 items-center justify-center rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        current
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
