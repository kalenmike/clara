import {
  applyUpdate,
  clearCachedAppData,
  dismissUpdate,
  usePwaUpdate,
  type UpdateStatus,
} from '@/features/pwa/update-store'
import { isDesktop } from '@/lib/runtime'

/**
 * The update surface the UI talks to. The web build is updated by its service
 * worker; the desktop build is updated by the native updater, which is not
 * wired yet, so it reports that updates come with the app.
 */
export type AppUpdateChannel = 'web' | 'installer'

export type AppUpdate = {
  status: UpdateStatus
  /** Set when the user chose "Later"; a newer worker asks again. */
  dismissed: boolean
  channel: AppUpdateChannel
}

const INSTALLER_IDLE: AppUpdate = { status: 'idle', dismissed: false, channel: 'installer' }

/** Reads the update state for the running surface. */
export function useAppUpdate(): AppUpdate {
  const pwa = usePwaUpdate()
  return isDesktop ? INSTALLER_IDLE : { ...pwa, channel: 'web' }
}

/** Hands over to the new build and reloads. A no-op before an updater exists. */
export async function applyAppUpdate(): Promise<void> {
  if (isDesktop) return
  await applyUpdate()
}

export function dismissAppUpdate(): void {
  if (isDesktop) return
  dismissUpdate()
}

/**
 * Reloads onto the newest deployed build without asking the worker first.
 *
 * The update banner only exists inside the app shell, so an unpaired client or
 * one stuck on the boot splash can never reach it. Clearing the registration
 * and caches is the reliable answer: a cached shell can otherwise answer the
 * navigation for up to three seconds, which is the stale screen being escaped.
 * The desktop shell has no worker and installs with its assets, so it reloads.
 */
export async function reloadApp(): Promise<void> {
  if (isDesktop) {
    window.location.reload()
    return
  }
  await clearCachedAppData()
}
