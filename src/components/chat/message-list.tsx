import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import type { SessionMessageInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { MessageItem } from '@/components/chat/message-item'
import { cn } from '@/lib/utils'

export function MessageList({
  messages,
  streaming,
  showInternal,
  revision,
  historyRevision,
  collapsedIDs,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onToggleMessage,
}: {
  messages: SessionMessageInfo[]
  streaming: boolean
  showInternal: boolean
  revision: number
  historyRevision: number
  collapsedIDs: ReadonlySet<string>
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onToggleMessage: (id: string) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [showJump, setShowJump] = useState(false)
  const userScrolled = useRef(false)
  const anchorID = useRef<string | null>(null)
  const anchorOffset = useRef(0)
  const skipAutoScroll = useRef(false)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  const scrollToBottom = () => {
    if (messages.length === 0) return
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    setAtBottom(true)
    setShowJump(false)
    userScrolled.current = false
  }

  const requestOlder = () => {
    if (!hasOlder || loadingOlder) return
    const offset = parentRef.current?.scrollTop ?? 0
    const first = virtualizer.getVirtualItems().find((item) => item.end > offset)
    const message = first ? messages[first.index] : undefined
    anchorID.current = message?.id ?? null
    anchorOffset.current = first ? Math.max(0, offset - first.start) : 0
    onLoadOlder()
  }

  useLayoutEffect(() => {
    const anchor = anchorID.current
    if (!anchor) return
    anchorID.current = null
    const index = messages.findIndex((message) => message.id === anchor)
    if (index === -1) return
    skipAutoScroll.current = true
    const target = virtualizer.getOffsetForIndex(index, 'start')
    if (target) virtualizer.scrollToOffset(target[0] + anchorOffset.current)
    else virtualizer.scrollToIndex(index, { align: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRevision])

  useEffect(() => {
    if (skipAutoScroll.current) {
      skipAutoScroll.current = false
      return
    }
    if (!atBottom) return
    const frame = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, revision, atBottom])

  const onScroll = () => {
    const element = parentRef.current
    if (!element) return
    if (element.scrollTop < 240) requestOlder()
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    setAtBottom(bottom)
    setShowJump(userScrolled.current && !bottom)
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
        }}
        onTouchMove={() => {
          userScrolled.current = true
        }}
        className="h-full overflow-y-auto pb-28"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const message = messages[item.index]
            if (!message) return null
            const isLast = item.index === messages.length - 1
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
                <MessageItem
                  message={message}
                  streaming={streaming && isLast}
                  showInternal={showInternal}
                  collapsed={collapsedIDs.has(message.id)}
                  onToggle={() => onToggleMessage(message.id)}
                />
              </div>
            )
          })}
        </div>
      </div>

      <Button
        type="button"
        size="icon"
        variant="secondary"
        onClick={scrollToBottom}
        className={cn(
          'absolute bottom-4 left-1/2 size-8 -translate-x-1/2 rounded-full shadow-md transition-opacity md:bottom-16',
          showJump ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <ArrowDown className="size-4" />
        <span className="sr-only">Scroll to bottom</span>
      </Button>
    </div>
  )
}
