import { useEffect } from 'react'
import type { ClaraSession } from '@clara/api-contract'
import { isSessionUnread } from '@/features/sessions/session-unread'
import { useConnection } from '@/providers/connection-provider'

function isViewing(): boolean {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
  )
}

/**
 * Report the newest idle transition once the session is actually on screen.
 * The server ignores stale and duplicate reports, so focus and visibility
 * changes can safely retry.
 */
export function useMarkSessionViewed(session: ClaraSession | undefined): void {
  const { client } = useConnection()
  const sessionID = session?.id
  const idle = session?.time.idle
  const unread = session ? isSessionUnread(session) : false

  useEffect(() => {
    if (!client || !sessionID || idle === undefined || !unread) return

    const mark = () => {
      if (!isViewing()) return
      void client.session.view({ sessionID, idle }).catch(() => {})
    }

    mark()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') mark()
    }
    window.addEventListener('focus', mark)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', mark)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [client, idle, sessionID, unread])
}
