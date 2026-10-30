import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, MessageSquare, Sparkles } from 'lucide-react'
import type { SessionMessageInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { MessageItem } from '@/components/chat/message-item'
import { cn } from '@/lib/utils'

export function MessageList({
  messages,
  streaming,
  revision,
}: {
  messages: SessionMessageInfo[]
  streaming: boolean
  revision: number
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [showJump, setShowJump] = useState(false)
  const userScrolled = useRef(false)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
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

  useEffect(() => {
    if (!atBottom) return
    const frame = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, revision, atBottom])

  const onScroll = () => {
    const element = parentRef.current
    if (!element) return
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    setAtBottom(bottom)
    setShowJump(userScrolled.current && !bottom)
  }

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border bg-card">
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Start the conversation</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Type a prompt, use <kbd className="rounded border px-1">/</kbd> for commands, or{' '}
            <kbd className="rounded border px-1">@</kbd> to reference files and agents.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <MessageSquare className="size-3" /> Messages stream in live from the server.
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={parentRef}
        onScroll={onScroll}
        onWheel={() => {
          userScrolled.current = true
        }}
        onTouchMove={() => {
          userScrolled.current = true
        }}
        className="h-full overflow-y-auto"
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
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <MessageItem message={message} streaming={streaming && isLast} />
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
          'absolute bottom-4 left-1/2 size-8 -translate-x-1/2 rounded-full shadow-md transition-opacity',
          showJump ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <ArrowDown className="size-4" />
        <span className="sr-only">Scroll to bottom</span>
      </Button>
    </div>
  )
}
