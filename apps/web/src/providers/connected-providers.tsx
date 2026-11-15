import type { ReactNode } from 'react'
import { InboxMonitorProvider } from '@/features/sessions/inbox-monitor'
import { NotificationProvider } from '@/providers/notification-provider'
import { PushProvider } from '@/providers/push-provider'
import { SettingsSyncProvider } from '@/providers/settings-sync-provider'

/**
 * The providers every connected surface needs. The chat shell mounts them
 * around its sidebar layout, and the full-window routes mount the same stack so
 * settings sync, push reconciliation, notifications, and Inbox monitoring keep
 * running while the project sidebar is not on screen.
 */
export function ConnectedProviders({ children }: { children: ReactNode }) {
  return (
    <InboxMonitorProvider>
      <SettingsSyncProvider>
        <PushProvider>
          <NotificationProvider>{children}</NotificationProvider>
        </PushProvider>
      </SettingsSyncProvider>
    </InboxMonitorProvider>
  )
}
