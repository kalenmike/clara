import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMessageInfo } from '@opencode/client'

type CollapsibleMessage = Extract<SessionMessageInfo, { type: 'user' | 'assistant' | 'shell' }>

export function isCollapsibleMessage(message: SessionMessageInfo): message is CollapsibleMessage {
  return message.type === 'user' || message.type === 'assistant' || message.type === 'shell'
}

/**
 * Keeps collapse state for the current session in memory.
 *
 * The newest message starts expanded and every earlier message starts collapsed.
 * When a new message becomes the newest, the previous one collapses unless the
 * person expanded or collapsed it explicitly.
 */
export function useCollapsedMessages(sessionID: string, messages: SessionMessageInfo[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const manual = useRef(new Set<string>())
  const autoExpanded = useRef<string | null>(null)
  const initialized = useRef(false)
  const currentSession = useRef<string | null>(null)

  const collapsibleIDs = useMemo(
    () => messages.filter(isCollapsibleMessage).map((message) => message.id),
    [messages]
  )

  useEffect(() => {
    if (currentSession.current !== sessionID) {
      currentSession.current = sessionID
      initialized.current = false
      manual.current = new Set()
      autoExpanded.current = null
      setCollapsed(new Set())
    }

    if (collapsibleIDs.length === 0) return
    const lastID = collapsibleIDs[collapsibleIDs.length - 1]
    if (!lastID) return

    if (!initialized.current) {
      initialized.current = true
      autoExpanded.current = lastID
      setCollapsed(new Set(collapsibleIDs.filter((id) => id !== lastID)))
      return
    }

    const previous = autoExpanded.current
    if (previous === lastID) return
    autoExpanded.current = lastID
    setCollapsed((current) => {
      const next = new Set(current)
      if (previous && !manual.current.has(previous)) next.add(previous)
      if (!manual.current.has(lastID)) next.delete(lastID)
      return next
    })
  }, [collapsibleIDs, sessionID])

  const allCollapsed = collapsibleIDs.length > 0 && collapsibleIDs.every((id) => collapsed.has(id))

  const toggleMessage = useCallback((id: string) => {
    manual.current.add(id)
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (collapsibleIDs.length === 0) return
    manual.current = new Set(collapsibleIDs)
    setCollapsed((current) => {
      const anyCollapsed = collapsibleIDs.some((id) => current.has(id))
      return anyCollapsed ? new Set() : new Set(collapsibleIDs)
    })
  }, [collapsibleIDs])

  return {
    collapsedIDs: collapsed,
    allCollapsed,
    canToggleAll: collapsibleIDs.length > 0,
    toggleMessage,
    toggleAll,
  }
}
