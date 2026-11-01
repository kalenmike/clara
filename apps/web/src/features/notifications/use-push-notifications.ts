import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PushSubscriptionPayload } from '@clara/shared-types'
import { isRelayConfig } from '@/lib/client'
import { useConnection } from '@/providers/connection-provider'
import { readNotificationPermission, requestNotificationPermission } from './notifier'
import {
  describePushError,
  isIos,
  isStandalone,
  pushSupported,
  readPushSubscription,
  subscribeToPush,
  toPushSubscriptionPayload,
  unsubscribeFromPush,
} from './push'
import { readDeviceClass } from './presence'
import { useNotificationSettings } from './use-notification-settings'

export type PushNotificationsState = {
  supported: boolean
  available: boolean
  enabled: boolean
  busy: boolean
  error: string | null
  reason: string | null
  count: number | null
  isIosDevice: boolean
  isInstalled: boolean
  enable: () => Promise<void>
  disable: () => Promise<void>
  test: () => Promise<void>
}

export function usePushNotifications(): PushNotificationsState {
  const { config, control, generation, relayStatus } = useConnection()
  const { settings, update } = useNotificationSettings()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)

  const supported = pushSupported()
  const publicKey = relayStatus?.agent?.pushPublicKey
  const relayMode = Boolean(config && isRelayConfig(config))
  const online = relayStatus?.state === 'open'
  const available = supported && relayMode && online && Boolean(control && publicKey)
  const isIosDevice = isIos()
  const isInstalled = isStandalone()

  const reason = useMemo(() => {
    if (!supported) return 'This browser does not support Web Push notifications.'
    if (!relayMode) {
      return 'Push needs the Clara home agent. Connect with a pairing code or local WebSocket.'
    }
    if (!online) return 'Connect to the Clara home server to manage push notifications.'
    if (!publicKey) {
      return 'The Clara home server does not support push notifications yet. Update and reconnect it.'
    }
    if (!control) return 'The Clara transport is still starting.'
    if (isIosDevice && !isInstalled) {
      return 'On iPhone and iPad, add Clara to the Home Screen and open it from that icon first.'
    }
    return null
  }, [control, isInstalled, isIosDevice, online, publicKey, relayMode, supported])

  const sendSubscription = useCallback(
    async (subscription: PushSubscriptionPayload) => {
      if (!control) throw new Error('The Clara transport is not connected')
      await control.send({
        type: 'push.subscribe',
        id: requestId(),
        subscription,
        userAgent: navigator.userAgent.slice(0, 200),
        deviceClass: readDeviceClass(),
      })
    },
    [control]
  )

  const refresh = useCallback(async () => {
    if (!supported) {
      setEnabled(false)
      return
    }

    if (!available || !control || !publicKey) {
      setEnabled(false)
      return
    }

    if (!settings.push) {
      await unsubscribeFromPush()
      setEnabled(false)
      return
    }

    try {
      if (readNotificationPermission() !== 'granted') {
        update({ push: false })
        setEnabled(false)
        return
      }

      const existing = await readPushSubscription()
      if (!existing) {
        update({ push: false })
        setEnabled(false)
        return
      }

      const subscription = await subscribeToPush(publicKey)
      await sendSubscription(toPushSubscriptionPayload(subscription))
      setEnabled(true)
      setError(null)
    } catch (cause) {
      setEnabled(false)
      setError(describePushError(cause))
    }
  }, [available, control, publicKey, sendSubscription, settings.push, supported, update])

  useEffect(() => {
    void refresh()
  }, [refresh, generation])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onChange = (event: MessageEvent) => {
      if (event.data?.type === 'clara.push.subscription-change') void refresh()
    }
    navigator.serviceWorker.addEventListener('message', onChange)
    return () => navigator.serviceWorker.removeEventListener('message', onChange)
  }, [refresh])

  useEffect(() => {
    if (!control) return
    return control.subscribePush((state) => {
      if (state.error) {
        setError(state.error)
        if (!state.tested || !state.subscribed) setEnabled(false)
        return
      }
      if (typeof state.count === 'number') setCount(state.count)
      if (state.tested) {
        setError(null)
        if (!state.subscribed) setEnabled(false)
        return
      }
      if (state.subscribed) {
        setEnabled(true)
        setError(null)
      }
    })
  }, [control])

  const enable = useCallback(async () => {
    if (!available || !control || !publicKey) {
      setError(reason ?? 'Push notifications are not available')
      return
    }

    setBusy(true)
    setError(null)
    try {
      if (readNotificationPermission() !== 'granted') {
        const permission = await requestNotificationPermission()
        if (permission !== 'granted') {
          throw new Error('Notification permission was not granted')
        }
      }

      const subscription = await subscribeToPush(publicKey)
      await sendSubscription(toPushSubscriptionPayload(subscription))
      update({ push: true })
      setEnabled(true)
    } catch (cause) {
      setError(describePushError(cause))
      setEnabled(false)
    } finally {
      setBusy(false)
    }
  }, [available, control, publicKey, reason, sendSubscription, update])

  const disable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const subscription = await readPushSubscription()
      if (subscription && control) {
        await control
          .send({
            type: 'push.unsubscribe',
            id: requestId(),
            endpoint: subscription.endpoint,
          })
          .catch(() => undefined)
      }
      await unsubscribeFromPush()
      update({ push: false })
      setEnabled(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [control, update])

  const test = useCallback(async () => {
    if (!control) {
      setError('The Clara transport is not connected')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const subscription = await readPushSubscription()
      if (!subscription) throw new Error('This device is not subscribed to push notifications')
      await control.send({
        type: 'push.test',
        id: requestId(),
        endpoint: subscription.endpoint,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [control])

  return {
    supported,
    available,
    enabled,
    busy,
    error,
    reason,
    count,
    isIosDevice,
    isInstalled,
    enable,
    disable,
    test,
  }
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
