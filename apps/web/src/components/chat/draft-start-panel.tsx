import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { RequestCard } from '@/components/chat/request-card'
import { Button } from '@clara/ui/components/button'
import { isLocationRecoveryError } from '@/features/chat/location-recovery'
import { claraEventMetadata } from '@/features/chat/system-events'
import { useSendSynthetic } from '@/features/chat/use-chat'

export function DraftStartPanel({ sessionID, count }: { sessionID: string; count: number }) {
  const sendSynthetic = useSendSynthetic(sessionID)
  const [starting, setStarting] = useState(false)
  const pending = starting || sendSynthetic.isPending

  const start = async () => {
    if (pending) return
    setStarting(true)
    try {
      await sendSynthetic.mutateAsync({
        text:
          count === 1
            ? 'The user approved the saved draft. Start working on it.'
            : 'The user approved the saved drafts. Start working on them.',
        description:
          count === 1
            ? 'User confirmed. Starting saved draft.'
            : `User confirmed. Starting ${count} saved drafts.`,
        metadata: claraEventMetadata('draft-start'),
        delivery: 'steer',
        resume: true,
      })
    } catch (cause) {
      setStarting(false)
      if (isLocationRecoveryError(cause)) return
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
