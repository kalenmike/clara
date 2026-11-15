import type { ClaraSurface } from '@clara/shared-types'

/**
 * Which surface this bundle runs on. The desktop shell is built in desktop mode
 * (see `apps/desktop`), so the flag is fixed at build time; the web deploy and
 * its PWA behavior keep the default.
 */
export const isDesktop = import.meta.env.CLARA_DESKTOP === true

/** True when the browser is showing an installed app rather than a tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  )
}

/** The label used beside the version in the UI. */
export function claraSurface(): ClaraSurface {
  if (isDesktop) return 'desktop'
  return isStandalone() ? 'pwa' : 'web'
}
