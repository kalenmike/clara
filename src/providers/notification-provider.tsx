import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { readSessionWording } from '@/features/sessions/wording'
import type { AttentionKind } from '@/features/notifications/attention'
import {
  readNotificationPermission,
  showDesktopNotification,
} from '@/features/notifications/notifier'
import {
  getSessionInfo,
  loadSessionAttention,
  resolveProjectID,
} from '@/features/notifications/session-attention'
import { readNotificationSettings } from '@/features/notifications/settings'
import { ensureSoundUnlock, playAttentionSound } from '@/features/notifications/sounds'
import { useConnection } from '@/providers/connection-provider'
import { useEventStream } from '@/providers/event-provider'

/** Wait for the server to persist the last message before classifying a run. */
const EVALUATE_DELAY_MS = 750
/** Suppress the same state twice for a session when events overlap. */
const ALERT_COOLDOWN_MS = 5_000
const BODY_DETAIL_MAX = 180

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { client } = useConnection()
  const { subscribe } = useEventStream()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!client) return
    ensureSoundUnlock()

    const lastAlert = new Map<string, { kind: AttentionKind; at: number }>()
    const timers = new Map<string, number>()
    const interrupted = new Set<string>()
    let disposed = false

    const claimAlert = (sessionID: string, kind: AttentionKind) => {
      const previous = lastAlert.get(sessionID)
      const now = Date.now()
      if (previous && previous.kind === kind && now - previous.at < ALERT_COOLDOWN_MS) {
        return false
      }
      lastAlert.set(sessionID, { kind, at: now })
      return true
    }

    const viewingSession = (sessionID: string) => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return false
      const match = /\/s\/([^/]+)\/?$/.exec(window.location.pathname)
      return match?.[1] === sessionID
    }

    const openSession = (session: SessionInfo) => {
      void resolveProjectID(client, queryClient, session)
        .then((projectID) => {
          if (projectID) navigate(`/p/${projectID}/s/${session.id}`)
        })
        .catch(() => undefined)
    }

    const notify = async (
      sessionID: string,
      kind: AttentionKind,
      detail?: string,
      known?: SessionInfo
    ) => {
      if (disposed) return
      try {
        if (!claimAlert(sessionID, kind)) return
        if (viewingSession(sessionID)) return

        const settings = readNotificationSettings()
        if (settings.sounds && settings.soundKinds[kind]) {
          playAttentionSound(kind, settings.volume)
        }

        if (!settings.desktop || readNotificationPermission() !== 'granted') return

        let session = known
        if (!session) {
          try {
            session = await getSessionInfo(client, queryClient, sessionID)
          } catch {
            return
          }
        }
        if (disposed || isArchivedSession(session) || isSnoozedSession(session)) return

        showDesktopNotification({
          kind,
          sessionID,
          body: attentionBody(kind, session.title, detail),
          onOpen: () => openSession(session),
        })
      } catch {
        // Alerts are best effort; the sidebar remains the source of truth.
      }
    }

    const evaluate = async (sessionID: string) => {
      if (disposed) return
      if (interrupted.delete(sessionID)) return

      try {
        const attention = await loadSessionAttention(client, queryClient, sessionID)
        if (!attention || disposed) return
        await notify(sessionID, attention.kind, undefined, attention.session)
      } catch {
        // Notification work is best effort; the sidebar still shows the state.
      }
    }

    const scheduleEvaluation = (sessionID: string) => {
      const existing = timers.get(sessionID)
      if (existing) window.clearTimeout(existing)
      timers.set(
        sessionID,
        window.setTimeout(() => {
          timers.delete(sessionID)
          void evaluate(sessionID)
        }, EVALUATE_DELAY_MS)
      )
    }

    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case 'permission.asked':
          void notify(event.data.sessionID, 'question', event.data.message ?? event.data.action)
          return

        case 'form.created':
          void notify(event.data.form.sessionID, 'question', event.data.form.title)
          return

        case 'session.execution.failed':
          void notify(event.data.sessionID, 'error', event.data.error.message)
          return

        case 'session.execution.interrupted':
          interrupted.add(event.data.sessionID)
          return

        case 'session.execution.started': {
          interrupted.delete(event.data.sessionID)
          const pending = timers.get(event.data.sessionID)
          if (pending) {
            window.clearTimeout(pending)
            timers.delete(event.data.sessionID)
          }
          return
        }

        case 'session.execution.succeeded':
        case 'session.idle':
          scheduleEvaluation(event.data.sessionID)
          return
      }
    })

    return () => {
      disposed = true
      unsubscribe()
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [client, subscribe, queryClient, navigate])

  return <>{children}</>
}

function attentionBody(kind: AttentionKind, title: string | undefined, detail?: string): string {
  const name = title?.trim() || `Untitled ${readSessionWording().lowerSingular}`
  const suffix = detail?.trim() ? `: ${clip(detail)}` : '.'

  switch (kind) {
    case 'review':
      return `Agent finished “${name}” — ready for review.`
    case 'question':
      return `Agent is waiting on you in “${name}”${suffix}`
    case 'plan':
      return `Plan is ready in “${name}” — build it or steer first.`
    case 'error':
      return `Run failed in “${name}”${suffix}`
  }
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > BODY_DETAIL_MAX ? `${clean.slice(0, BODY_DETAIL_MAX - 1)}…` : clean
}
