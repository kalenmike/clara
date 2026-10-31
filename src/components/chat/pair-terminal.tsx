import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, SquareTerminal } from 'lucide-react'
import type { SessionMessageInfo } from '@opencode/client'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import {
  buildTerminalLog,
  type TerminalEntry,
  type TerminalStatus,
} from '@/features/chat/terminal-log'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEventStream } from '@/providers/event-provider'

export function PairTerminal({
  sessionID,
  title,
  directory,
  messages,
  status,
}: {
  sessionID: string
  title?: string
  directory?: string
  messages: SessionMessageInfo[]
  status: ChatSnapshot['status']
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const log = useMemo(() => buildTerminalLog(messages), [messages])
  const live = useEventStream().live
  const running = status.type !== 'idle'

  useEffect(() => {
    setFollow(true)
  }, [sessionID])

  useEffect(() => {
    if (!follow) return
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current
      if (element) element.scrollTop = element.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [follow, log.entries, sessionID])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    setFollow(atBottom)
  }

  const jumpToLive = () => {
    setFollow(true)
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  const stateLabel =
    status.type === 'retry'
      ? `retrying ${status.attempt}`
      : running
        ? live
          ? 'running'
          : 'reconnecting'
        : 'idle'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#090d12] text-zinc-200">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-900 px-3">
        <SquareTerminal className="size-3.5 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-zinc-100">Pair terminal</div>
          <div className="truncate font-mono text-[10px] text-zinc-500">
            {title || directory || 'This session'}
          </div>
        </div>
        <div
          className="flex shrink-0 items-center gap-1.5 text-[10px] text-zinc-400"
          title={live ? 'Live event stream connected' : 'Live event stream disconnected'}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              stateLabel === 'running' && 'animate-pulse bg-emerald-400',
              stateLabel === 'reconnecting' && 'bg-amber-400',
              stateLabel === 'retrying' && 'bg-amber-400',
              stateLabel === 'idle' && 'bg-zinc-600'
            )}
          />
          {stateLabel}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          aria-label="Pair terminal output"
          className="h-full overflow-y-auto overscroll-contain px-3 py-3 font-mono text-[11.5px] leading-[1.65] [tab-size:2]"
        >
          {log.truncated && (
            <div className="mb-3 text-[10px] text-zinc-600">Earlier activity is not shown.</div>
          )}

          {log.entries.length === 0 ? (
            <EmptyTerminal running={running} />
          ) : (
            log.entries.map((entry) => <TerminalEntryView key={entry.id} entry={entry} />)
          )}
        </div>

        {!follow && (
          <button
            type="button"
            onClick={jumpToLive}
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-200 shadow-lg transition-colors hover:bg-zinc-700"
          >
            <ArrowDown className="size-3" /> Jump to live
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyTerminal({ running }: { running: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-zinc-500">
      <span className="text-base text-emerald-400">$</span>
      <p>{running ? 'Waiting for the agent to run a command…' : 'No commands yet.'}</p>
      <p className="max-w-64 text-[10px] text-zinc-600">
        {running
          ? 'Commands and their output appear here as the agent works.'
          : 'Send a prompt and watch the agent work in real time.'}
      </p>
    </div>
  )
}

function TerminalEntryView({ entry }: { entry: TerminalEntry }) {
  if (entry.kind === 'prompt') {
    return (
      <div className="mt-3 flex gap-2 first:mt-0">
        <span className="shrink-0 select-none text-cyan-400/80">❯</span>
        <span className="min-w-0 break-words text-zinc-400">{entry.text}</span>
      </div>
    )
  }

  if (entry.kind === 'command') {
    return (
      <div className="mt-3 first:mt-0">
        {entry.description && (
          <div className="mb-0.5 pl-4 text-[10px] text-zinc-600">{entry.description}</div>
        )}
        <div className="flex gap-2">
          <span className="shrink-0 select-none text-emerald-400">$</span>
          <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-100">
            {entry.command}
          </span>
        </div>
        {entry.output && (
          <pre className="mt-1 ml-4 whitespace-pre-wrap break-words border-l border-white/10 pl-3 text-zinc-300">
            {entry.output}
          </pre>
        )}
        {entry.error && (
          <div className="mt-1 ml-4 border-l border-rose-500/30 pl-3 text-rose-400">
            {entry.error}
          </div>
        )}
        <div
          className={cn(
            'mt-1 ml-4 flex items-center gap-1.5 text-[10px]',
            commandTone(entry.status)
          )}
        >
          {(entry.status === 'running' || entry.status === 'preparing') && (
            <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
          )}
          {commandStatus(entry)}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-1 flex items-baseline gap-2 first:mt-0">
      <span className={cn('shrink-0 select-none', toolTone(entry.status))}>›</span>
      <span className="shrink-0 text-zinc-300">{entry.name}</span>
      {entry.summary && (
        <span className="min-w-0 flex-1 truncate text-zinc-500">{entry.summary}</span>
      )}
      <span className={cn('shrink-0 text-[10px]', toolTone(entry.status))}>
        {statusLabel(entry.status)}
      </span>
    </div>
  )
}

function commandStatus(entry: Extract<TerminalEntry, { kind: 'command' }>): string {
  const parts = [statusLabel(entry.status)]
  if (entry.exit !== undefined) parts.push(`exit ${entry.exit}`)
  if (entry.completed) parts.push(formatDuration(entry.started, entry.completed))
  return parts.join(' · ')
}

function statusLabel(status: TerminalStatus): string {
  switch (status) {
    case 'preparing':
      return 'preparing'
    case 'running':
      return 'running'
    case 'completed':
      return 'done'
    case 'error':
      return 'failed'
    case 'timeout':
      return 'timed out'
    case 'killed':
      return 'killed'
  }
}

function commandTone(status: TerminalStatus): string {
  if (status === 'error' || status === 'timeout' || status === 'killed') return 'text-rose-400'
  if (status === 'running' || status === 'preparing') return 'text-emerald-400/80'
  return 'text-zinc-600'
}

function toolTone(status: TerminalStatus): string {
  if (status === 'error' || status === 'timeout' || status === 'killed') return 'text-rose-400'
  if (status === 'running' || status === 'preparing') return 'text-emerald-400/80'
  return 'text-zinc-500'
}
