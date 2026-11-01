import { useState } from 'react'
import { Hammer, Loader2, Sparkles, SquarePen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSendPrompt, useSwitchAgent } from '@/features/chat/use-chat'

export function PlanReadyPanel({
  sessionID,
  onSteer,
  onBuild,
}: {
  sessionID: string
  onSteer: () => void
  onBuild?: () => void
}) {
  const switchAgent = useSwitchAgent(sessionID)
  const sendPrompt = useSendPrompt(sessionID)
  const [starting, setStarting] = useState(false)
  const pending = starting || switchAgent.isPending || sendPrompt.isPending

  const startBuild = async () => {
    if (pending) return
    setStarting(true)
    let switched = false
    let sent = false
    try {
      await switchAgent.mutateAsync('build')
      switched = true
      await sendPrompt.mutateAsync({ text: 'Confirmed', delivery: 'steer' })
      sent = true
    } catch {
      toast.error(
        switched
          ? 'Switched to Build, but could not send "Confirmed". Send it from the reply box.'
          : 'Could not switch to Build. Try again.'
      )
    } finally {
      setStarting(false)
    }
    if (sent) onBuild?.()
  }

  return (
    <div className="shrink-0 border-b bg-sky-500/5 p-2 md:p-3">
      <section
        aria-label="Plan ready"
        className="mx-auto max-w-3xl rounded-xl border border-sky-500/30 bg-card p-3"
      >
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 text-sky-500" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">Plan is ready</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              I&apos;m ready to implement on your say so. Should I build it, or do you want to steer
              first?
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
                onClick={onSteer}
                disabled={pending}
              >
                <SquarePen className="size-3.5 max-md:size-5" />
                Steer
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
                onClick={() => void startBuild()}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin max-md:size-5" />
                ) : (
                  <Hammer className="size-3.5 max-md:size-5" />
                )}
                Build
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
