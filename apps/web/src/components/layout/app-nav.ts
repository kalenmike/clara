/**
 * Destinations in the fixed app header. The header is shared by the chat
 * shell, the hub panel, and Clara Lab, so the list and its active rules live
 * here instead of inside the header component.
 */
export type AppNavItem = {
  key: string
  to: string
  label: string
  /** Matched against `location.pathname` to mark the current section. */
  active: (pathname: string) => boolean
  /** Routed only where the surface exists (Clara Lab needs the desktop shell). */
  desktopOnly?: boolean
}

const pathWithin = (pathname: string, root: string) =>
  pathname === root || pathname.startsWith(`${root}/`)

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  {
    key: 'chat',
    to: '/',
    label: 'Chat',
    // The start view, the project browser, and every session are one section.
    active: (pathname) =>
      pathname === '/' || pathname.startsWith('/p/') || pathWithin(pathname, '/projects'),
  },
  {
    key: 'activity',
    to: '/activity',
    label: 'Activity',
    active: (pathname) => pathWithin(pathname, '/activity'),
  },
  {
    key: 'panel',
    to: '/hub',
    label: 'Panel',
    active: (pathname) => pathWithin(pathname, '/hub'),
  },
  {
    key: 'lab',
    to: '/lab',
    label: 'Lab',
    active: (pathname) => pathWithin(pathname, '/lab'),
    desktopOnly: true,
  },
  {
    key: 'settings',
    to: '/settings',
    label: 'Settings',
    active: (pathname) => pathWithin(pathname, '/settings'),
  },
]

export function visibleAppNavItems(desktop: boolean): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => !item.desktopOnly || desktop)
}

export function isAppNavItemActive(item: AppNavItem, pathname: string): boolean {
  return item.active(pathname)
}
