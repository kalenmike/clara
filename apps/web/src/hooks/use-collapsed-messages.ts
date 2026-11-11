import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClaraSessionMessage } from '@clara/api-contract'
import { assistantHasReply } from '@/features/chat/message-visibility'

type CollapsibleMessage = Extract<ClaraSessionMessage, { type: 'user' | 'assistant' | 'shell' }>

export function isCollapsibleMessage(message: ClaraSessionMessage): message is CollapsibleMessage {
  return message.type === 'user' || message.type === 'assistant' || message.type === 'shell'
}

/** Whether a message can take over as the newest expanded message. */
function canBeAnchor(message: CollapsibleMessage): boolean {
  return message.type !== 'assistant' || assistantHasReply(message)
}

/**
 * Keeps collapse state for the current session in memory.
 *
 * The newest prompt or reply starts expanded and every earlier reply starts
 * collapsed. An assistant step without text yet (thinking or tool calls) does
 * not take over the anchor, so the prompt that started the run stays open until
 * the agent actually replies. When the anchor moves, the previous one collapses
 * again unless the person expanded or collapsed it explicitly.
 */
export function useCollapsedMessages(sessionID: string, messages: ClaraSessionMessage[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const manual = useRef(new Set<string>())
  const autoExpanded = useRef<string | null>(null)
  const initialized = useRef(false)
  const currentSession = useRef<string | null>(null)

  const collapsible = useMemo(() => messages.filter(isCollapsibleMessage), [messages])
  const collapsibleIDs = useMemo(() => collapsible.map((message) => message.id), [collapsible])
  const anchorID = useMemo(() => {
    for (let index = collapsible.length - 1; index >= 0; index -= 1) {
      const message = collapsible[index]
      if (message && canBeAnchor(message)) return message.id
    }
    return null
  }, [collapsible])

  useEffect(() => {
    if (currentSession.current !== sessionID) {
      currentSession.current = sessionID
      initialized.current = false
      manual.current = new Set()
      autoExpanded.current = null
      setCollapsed(new Set())
    }

    if (!anchorID) return

    if (!initialized.current) {
      initialized.current = true
      autoExpanded.current = anchorID
      setCollapsed(
        new Set(
          collapsible
            .filter((message) => message.id !== anchorID && canBeAnchor(message))
            .map((message) => message.id)
        )
      )
      return
    }

    const previous = autoExpanded.current
    if (previous === anchorID) return
    autoExpanded.current = anchorID
    setCollapsed((current) => {
      const next = new Set(current)
      if (previous && !manual.current.has(previous)) next.add(previous)
      if (!manual.current.has(anchorID)) next.delete(anchorID)
      return next
    })
  }, [anchorID, collapsible, sessionID])

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
