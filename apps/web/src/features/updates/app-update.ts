import {
  applyUpdate,
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
