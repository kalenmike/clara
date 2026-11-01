import { useState } from 'react'
import { Loader2, Play, Sparkles, SquarePen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { claraEventMetadata } from '@/features/chat/system-events'
import { useSendSynthetic, useSwitchAgent } from '@/features/chat/use-chat'
import { useNotificationSettings } from '@/features/notifications/use-notification-settings'
import { playStartWorkSound } from '@/features/notifications/sounds'

export function PlanReadyPanel({
  sessionID,
  onAdjustPlan,
  onStartWork,
}: {
  sessionID: string
  onAdjustPlan: () => void
  onStartWork?: () => void
}) {
  const switchAgent = useSwitchAgent(sessionID)
  const sendSynthetic = useSendSynthetic(sessionID)
  const { settings } = useNotificationSettings()
  const [starting, setStarting] = useState(false)
  const pending = starting || switchAgent.isPending || sendSynthetic.isPending

  const startWork = async () => {
    if (pending) return
    if (settings.uiSounds) playStartWorkSound(settings.volume)
    setStarting(true)
    let switched = false
    let sent = false
    try {
      await switchAgent.mutateAsync('build')
      switched = true
      await sendSynthetic.mutateAsync({
        text: 'The user approved the plan. Start working on it.',
        description: 'User confirmed. Starting work.',
        metadata: claraEventMetadata('build-start'),
        delivery: 'steer',
        resume: true,
      })
      sent = true
    } catch {
      toast.error(
        switched
          ? 'Switched agents, but could not start work. Send a message from the reply box.'
          : 'Could not switch agents. Try again.'
      )
    } finally {
      setStarting(false)
    }
    if (sent) onStartWork?.()
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
              I&apos;m ready to implement on your say so. Do you want to add anything or should I
              start?
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
                onClick={onAdjustPlan}
                disabled={pending}
              >
                <SquarePen className="size-3.5 max-md:size-5" />
                Adjust Plan
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
                onClick={() => void startWork()}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin max-md:size-5" />
                ) : (
                  <Play className="size-3.5 max-md:size-5" />
                )}
                Start Work
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
