/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import {
  usePushNotifications,
  type PushNotificationsState,
} from '@/features/notifications/use-push-notifications'

const PushContext = createContext<PushNotificationsState | null>(null)

/**
 * Keeps the browser subscription reconciled with the home agent for the whole
 * connected session, not just while the settings screen is open.
 */
export function PushProvider({ children }: { children: ReactNode }) {
  const value = usePushNotifications()
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>
}

export function usePush() {
  const value = useContext(PushContext)
  if (!value) throw new Error('usePush must be used inside PushProvider')
  return value
}
