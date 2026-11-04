import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { RequestCard } from '@/components/chat/request-card'
import { Button } from '@/components/ui/button'
import { useSendPrompt } from '@/features/chat/use-chat'

export function DraftStartPanel({ sessionID, count }: { sessionID: string; count: number }) {
  const sendPrompt = useSendPrompt(sessionID)
  const [starting, setStarting] = useState(false)
  const pending = starting || sendPrompt.isPending

  const start = async () => {
    if (pending) return
    setStarting(true)
    try {
      await sendPrompt.mutateAsync({ text: 'Start', delivery: 'steer' })
    } catch {
      setStarting(false)
      toast.error('Could not start the draft. Try again.')
    }
  }

  return (
    <div className="shrink-0 border-b bg-primary/5 p-2 md:p-3">
      <RequestCard
        title={count === 1 ? 'Draft saved' : `${count} drafts saved`}
        icon={Play}
        tone="primary"
      >
        <p className="text-[11px] text-muted-foreground">
          Start when you&apos;re ready to let the agent work on {count === 1 ? 'it' : 'them'}.
        </p>
        <div className="mt-3">
          <Button
            size="sm"
            className="h-7 gap-1 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
            onClick={() => void start()}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin max-md:size-5" />
            ) : (
              <Play className="size-3.5 max-md:size-5" />
            )}
            Start
          </Button>
        </div>
      </RequestCard>
    </div>
  )
}
