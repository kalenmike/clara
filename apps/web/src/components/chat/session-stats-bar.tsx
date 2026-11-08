import { useEffect, useState } from 'react'
import type { SessionInfo } from '@opencode/client'
import type { ChatSnapshot } from '@/features/chat/chat-store'
import { formatSessionUsage } from '@/features/chat/session-usage'
import { useSessionCost } from '@/features/cost/use-session-cost'
import { formatSessionAge } from '@/lib/format'

/** How often the relative age refreshes while the bar stays open. */
const AGE_REFRESH_MS = 60_000

/**
 * A thin whole-session summary pinned below the thread. Token and cost totals
 * come from the server rather than the lazily loaded pages, so the figures
 * stay whole for long conversations.
 */
export function SessionStatsBar({
  session,
  snapshot,
}: {
  session: SessionInfo
  snapshot: ChatSnapshot
}) {
  const cost = useSessionCost(session, snapshot)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  const tokens = snapshot.tokens ?? session.tokens
  const text = formatSessionUsage(tokens, cost, formatSessionAge(session.time.created, now))

  return (
    <footer
      aria-label="Session usage"
      className="flex shrink-0 items-center overflow-x-auto border-t bg-background px-3 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-[10px] whitespace-nowrap text-muted-foreground [scrollbar-width:none] md:text-xs [&::-webkit-scrollbar]:hidden"
    >
      <span className="font-mono">{text}</span>
    </footer>
  )
}
