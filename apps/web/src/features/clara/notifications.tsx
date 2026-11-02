import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { LedgerAlert } from '@clara/shared-types'
import type { AttentionKind } from '@/features/notifications/attention'
import {
  readNotificationPermission,
  showDesktopNotification,
} from '@/features/notifications/notifier'
import { readNotificationSettings } from '@/features/notifications/settings'
import { playAttentionSound } from '@/features/notifications/sounds'
import { useConnection } from '@/providers/connection-provider'

/**
 * Surfaces ledger exceptions as in-app toasts and desktop notifications. This
 * bridge is mounted only by the Clara feature provider, so generic
 * notifications never import ledger code.
 */
export function ClaraNotificationBridge() {
  const { control, relayStatus } = useConnection()
  const navigate = useNavigate()
  const management = relayStatus?.agent?.management === true

  useEffect(() => {
    const clara = control?.clara
    if (!management || !clara) return

    const delivered = new Set<string>()
    const notify = async (alert: LedgerAlert) => {
      if (delivered.has(alert.key)) return
      delivered.add(alert.key)
      if (delivered.size > 500) delivered.clear()

      if (document.visibilityState !== 'visible') return
      if (window.location.pathname.startsWith('/clara') && document.hasFocus()) return

      const kind: AttentionKind = alert.kind === 'kill' ? 'error' : 'question'
      const settings = readNotificationSettings()
      if (settings.sounds && settings.soundKinds[kind]) {
        playAttentionSound(kind, settings.volume)
      }

      const open = () => navigate('/clara')
      toast[kind === 'error' ? 'error' : 'info']('Clara needs you', {
        description: alert.title,
        action: { label: 'Open', onClick: open },
      })

      if (settings.desktop && readNotificationPermission() === 'granted') {
        await showDesktopNotification({
          kind,
          sessionID: `clara:${alert.key}`,
          body: `${alert.title}: ${alert.body}`,
          url: '/clara',
          onOpen: open,
        })
      }
    }

    return clara.subscribeLedgerAlert((alert) => {
      void notify(alert)
    })
  }, [control, management, navigate])

  return null
}
