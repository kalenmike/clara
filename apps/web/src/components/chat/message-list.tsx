import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ClaraSessionMessage } from '@clara/api-contract'
import { Button } from '@/components/ui/button'
import { HiddenActivityRow } from '@/components/chat/hidden-activity-row'
import { MessageItem } from '@/components/chat/message-item'
import { SystemEventRow } from '@/components/chat/system-event-row'
import { stepMessageIndex, type MessageStepDirection } from '@/features/chat/message-navigation'
import { canForwardMessage } from '@/features/sessions/forward'
import type { TimelineItem } from '@/features/chat/timeline'
import { cn } from '@/lib/utils'

/** A second press inside this window turns a step into an edge jump. */
const STEP_TAP_WINDOW = 250

export function MessageList({
  sessionID,
  items,
  streaming,
  showInternal,
  revision,
  historyRevision,
  collapsedIDs,
  hasOlder,
  loadingOlder,
  scrollToEndRequest,
  onLoadOlder,
  onToggleMessage,
  onForkMessage,
  onForwardMessage,
  canActOnMessage,
  canFork,
  actionsDisabled,
  composerDocked = false,
}: {
  sessionID: string
  items: TimelineItem[]
  streaming: boolean
  showInternal: boolean
  revision: number
  historyRevision: number
  collapsedIDs: ReadonlySet<string>
  hasOlder: boolean
  loadingOlder: boolean
  scrollToEndRequest: number
  onLoadOlder: () => void
  onToggleMessage: (id: string) => void
  onForkMessage: (message: ClaraSessionMessage) => void
  onForwardMessage: (message: ClaraSessionMessage, text?: string) => void
  canActOnMessage: (message: ClaraSessionMessage) => boolean
  canFork: boolean
  actionsDisabled: boolean
  /** The pinned composer sits below the thread, so it needs no floating-action gap. */
  composerDocked?: boolean
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [showJump, setShowJump] = useState(false)
  const [showUp, setShowUp] = useState(false)
  const [opened, setOpened] = useState(false)
  const [selectingID, setSelectingID] = useState<string | null>(null)
  const userScrolled = useRef(false)
  const anchorKey = useRef<string | null>(null)
  const anchorOffset = useRef(0)
  const skipAutoScroll = useRef(false)
  const openedSession = useRef<string | null>(null)
  const anchorSettling = useRef(false)
  const anchorFrame = useRef<number | null>(null)
  const handledScrollRequest = useRef(scrollToEndRequest)
  const stepTimer = useRef<number | null>(null)
  const stepDirection = useRef<MessageStepDirection | null>(null)
  const stepAction = useRef<(direction: MessageStepDirection) => void>(() => {})

  const lastMessageIndex = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.type === 'message') return index
    }
    return -1
  }, [items])

  const clearStepTimer = useCallback(() => {
    if (stepTimer.current !== null) window.clearTimeout(stepTimer.current)
    stepTimer.current = null
    stepDirection.current = null
  }, [])

  // Selection belongs to one reply at a time and never survives a session change.
  useEffect(() => {
    setSelectingID(null)
    clearStepTimer()
  }, [sessionID, clearStepTimer])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index) => items[index]?.key ?? index,
  })

  const cancelAnchor = () => {
    if (anchorFrame.current !== null) cancelAnimationFrame(anchorFrame.current)
    anchorFrame.current = null
    anchorSettling.current = false
  }

  /** Move to the newest output without disturbing an opening anchor. */
  const scrollToEnd = () => {
    if (items.length === 0) return
    setOpened(true)
    virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
    setAtBottom(true)
    setShowJump(false)
    const element = parentRef.current
    setShowUp(element ? element.scrollHeight > element.clientHeight + 1 : false)
    userScrolled.current = false
  }

  const scrollToBottom = () => {
    cancelAnchor()
    scrollToEnd()
  }

  /** Move to the oldest loaded row; the top edge keeps loading older pages. */
  const scrollToTop = () => {
    cancelAnchor()
    skipAutoScroll.current = false
    userScrolled.current = true
    setOpened(true)
    setAtBottom(false)
    setShowJump(true)
    setShowUp(false)
    virtualizer.scrollToOffset(0)
  }

  /** Index of the row crossing the top edge of the viewport. */
  const firstVisibleIndex = () => {
    const element = parentRef.current
    if (!element) return -1
    const first = virtualizer.getVirtualItems().find((item) => item.end > element.scrollTop + 1)
    return first?.index ?? -1
  }

  const scrollToItemStart = (index: number) => {
    if (index < 0 || index >= items.length) return
    cancelAnchor()
    skipAutoScroll.current = false
    userScrolled.current = true
    setOpened(true)
    setAtBottom(false)
    setShowJump(true)
    setShowUp(index > 0)
    virtualizer.scrollToIndex(index, { align: 'start' })
  }

  /** Step to the next or previous message, or to the edge when none remains. */
  const scrollToMessageStep = (direction: MessageStepDirection) => {
    const current = firstVisibleIndex()
    if (current === -1) {
      if (direction === 'down') scrollToBottom()
      else scrollToTop()
      return
    }

    const target = stepMessageIndex(items, current, direction)
    if (target === null) {
      if (direction === 'down') scrollToBottom()
      else scrollToTop()
      return
    }
    scrollToItemStart(target)
  }

  // Keep the delayed single step pointed at the newest timeline and measurements.
  stepAction.current = scrollToMessageStep

  /**
   * A single press steps one message after the double-tap window; a second
   * press on the same arrow jumps to the bottom or top immediately.
   */
  const handleStepPress = (direction: MessageStepDirection) => {
    if (stepDirection.current === direction && stepTimer.current !== null) {
      clearStepTimer()
      if (direction === 'down') scrollToBottom()
      else scrollToTop()
      return
    }

    clearStepTimer()
    stepDirection.current = direction
    stepTimer.current = window.setTimeout(() => {
      stepTimer.current = null
      stepDirection.current = null
      stepAction.current(direction)
    }, STEP_TAP_WINDOW)
  }

  /** Stop chasing the opening position and hand control back to the person. */
  const releaseAnchor = () => {
    if (!anchorSettling.current) return
    cancelAnchor()
    skipAutoScroll.current = false
    setOpened(true)
  }

  const requestOlder = () => {
    if (!hasOlder || loadingOlder) return
    const offset = parentRef.current?.scrollTop ?? 0
    const first = virtualizer.getVirtualItems().find((item) => item.end > offset)
    const item = first ? items[first.index] : undefined
    anchorKey.current = item?.key ?? null
    anchorOffset.current = first ? Math.max(0, offset - first.start) : 0
    onLoadOlder()
  }

  /**
   * Put the top of the newest message at the top of the thread so a long reply
   * is readable from its first line. Measurements land over a few frames, so
   * re-align briefly instead of trusting the first estimated offset.
   */
  const alignToLastMessage = () => {
    const index = lastMessageIndex >= 0 ? lastMessageIndex : items.length - 1
    if (!parentRef.current || index < 0) return

    anchorSettling.current = true
    setAtBottom(false)
    setShowJump(false)

    let attempts = 0
    const settle = () => {
      anchorFrame.current = null
      const element = parentRef.current
      if (!element || !anchorSettling.current) return

      const target = virtualizer.getOffsetForIndex(index, 'start')
      if (target && Math.abs(element.scrollTop - target[0]) > 1) {
        virtualizer.scrollToOffset(target[0])
      }

      attempts += 1
      if (attempts < 3) {
        anchorFrame.current = requestAnimationFrame(settle)
        return
      }

      anchorSettling.current = false
      skipAutoScroll.current = false
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      setAtBottom(bottom)
      setShowJump(!bottom)
      setShowUp(element.scrollTop > 0)
      setOpened(true)
      if (element.scrollTop < 240) requestOlder()
    }

    virtualizer.scrollToIndex(index, { align: 'start' })
    anchorFrame.current = requestAnimationFrame(settle)
  }

  useLayoutEffect(() => {
    const anchor = anchorKey.current
    if (!anchor) return
    anchorKey.current = null
    const index = items.findIndex((item) => item.key === anchor)
    if (index === -1) return
    skipAutoScroll.current = true
    const target = virtualizer.getOffsetForIndex(index, 'start')
    if (target) virtualizer.scrollToOffset(target[0] + anchorOffset.current)
    else virtualizer.scrollToIndex(index, { align: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRevision])

  useLayoutEffect(() => {
    if (items.length === 0) return
    if (openedSession.current !== sessionID) {
      // A newly opened thread starts fresh: stop the previous session's settle
      // and drop its scroll intent before anything else can act on it.
      cancelAnchor()
      userScrolled.current = false
      skipAutoScroll.current = false
      setOpened(false)
      setShowJump(false)
      setShowUp(false)
    }
    // Measure after the virtualizer has attached its scroll element, which its
    // own layout effect does after ours. Deferring also keeps StrictMode's
    // setup/cleanup/setup cycle from skipping the anchor.
    const frame = requestAnimationFrame(() => {
      if (openedSession.current === sessionID) return
      if (userScrolled.current) {
        openedSession.current = sessionID
        setOpened(true)
        return
      }
      openedSession.current = sessionID
      cancelAnchor()
      skipAutoScroll.current = false
      setShowJump(false)

      if (streaming) {
        setAtBottom(true)
        setOpened(true)
        return
      }

      setOpened(false)
      alignToLastMessage()
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionID, items.length, streaming])

  useEffect(() => {
    if (!opened) return
    // Never follow with another session's state while a new thread is opening.
    if (openedSession.current !== sessionID) return
    if (skipAutoScroll.current) {
      skipAutoScroll.current = false
      return
    }
    if (!atBottom) return
    const frame = requestAnimationFrame(scrollToEnd)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, sessionID, items.length, revision, atBottom])

  useEffect(() => {
    if (scrollToEndRequest === handledScrollRequest.current) return
    handledScrollRequest.current = scrollToEndRequest
    scrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToEndRequest])

  useEffect(
    () => () => {
      if (anchorFrame.current !== null) cancelAnimationFrame(anchorFrame.current)
      clearStepTimer()
    },
    [clearStepTimer]
  )

  const onScroll = () => {
    const element = parentRef.current
    if (!element) return
    if (element.scrollTop < 240) requestOlder()
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    setAtBottom(bottom)
    setShowJump(!bottom && (userScrolled.current || opened))
    setShowUp(element.scrollTop > 0)
  }

  return (
    <div className="relative min-h-0 flex-1">
      {loadingOlder && (
        <div className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          Loading earlier messages…
        </div>
      )}

      <div
        ref={parentRef}
        onScroll={onScroll}
        onWheel={() => {
          userScrolled.current = true
          clearStepTimer()
          releaseAnchor()
        }}
        onTouchMove={() => {
          userScrolled.current = true
          clearStepTimer()
          releaseAnchor()
        }}
        className={cn('h-full overflow-y-auto', composerDocked ? 'pb-4' : 'pb-28')}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = items[item.index]
            if (!entry) return null
            const isLast = item.index === items.length - 1
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cn(
                  'absolute left-0 top-0 w-full',
                  !isLast && 'border-b border-border/60 dark:border-white/15'
                )}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {entry.type === 'message' ? (
                  <MessageItem
                    message={entry.message}
                    streaming={streaming && item.index === lastMessageIndex}
                    showInternal={showInternal}
                    usageSummary={entry.usageSummary}
                    displayCost={entry.displayCost}
                    collapsed={collapsedIDs.has(entry.message.id)}
                    actions={
                      canActOnMessage(entry.message)
                        ? {
                            onFork: () => onForkMessage(entry.message),
                            onForward: () => onForwardMessage(entry.message),
                            onForwardSelection: (text) => onForwardMessage(entry.message, text),
                            onSelect: () =>
                              setSelectingID((current) =>
                                current === entry.message.id ? null : entry.message.id
                              ),
                            canFork,
                            canForward: canForwardMessage(entry.message),
                            canSelect:
                              entry.message.type === 'assistant' &&
                              !collapsedIDs.has(entry.message.id) &&
                              canForwardMessage(entry.message),
                            selecting: selectingID === entry.message.id,
                            disabled:
                              actionsDisabled || (streaming && item.index === lastMessageIndex),
                          }
                        : undefined
                    }
                    onToggle={() => onToggleMessage(entry.message.id)}
                  />
                ) : entry.type === 'hidden-activity' ? (
                  <HiddenActivityRow summary={entry.summary} streaming={entry.streaming} />
                ) : (
                  <SystemEventRow event={entry.event} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-20 flex flex-col items-center gap-2 md:bottom-16 max-md:left-5">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={() => handleStepPress('up')}
          disabled={!showUp}
          aria-hidden={!showUp}
          title="Previous message (double-tap for the top)"
          className={cn(
            'size-8 touch-manipulation rounded-full shadow-md transition-opacity max-md:size-11',
            showUp ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <ArrowUp className="size-4 max-md:size-5" />
          <span className="sr-only">Scroll to previous message; double-tap for the top</span>
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={() => handleStepPress('down')}
          disabled={!showJump}
          aria-hidden={!showJump}
          title="Next message (double-tap for the bottom)"
          className={cn(
            'size-8 touch-manipulation rounded-full shadow-md transition-opacity max-md:size-11',
            showJump ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <ArrowDown className="size-4 max-md:size-5" />
          <span className="sr-only">Scroll to next message; double-tap for the bottom</span>
        </Button>
      </div>
    </div>
  )
}
