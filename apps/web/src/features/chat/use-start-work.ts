import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { isLocationRecoveryError } from '@/features/chat/location-recovery'
import { claraEventMetadata } from '@/features/chat/system-events'
import {
  useSendPrompt,
  useSendSynthetic,
  useSwitchAgent,
  type PromptFile,
} from '@/features/chat/use-chat'
import { useNotificationSettings } from '@/features/notifications/use-notification-settings'
import { playStartWorkSound } from '@/features/notifications/sounds'

/**
 * Hand a finished plan to the working agent. A typed message starts the run as
 * a normal prompt; without one the synthetic approval keeps the transcript
 * free of a fake user prompt.
 */
export function useStartWork(sessionID: string) {
  const switchAgent = useSwitchAgent(sessionID)
  const sendSynthetic = useSendSynthetic(sessionID)
  const sendPrompt = useSendPrompt(sessionID)
  const { settings } = useNotificationSettings()
  const [starting, setStarting] = useState(false)
  const running = useRef(false)

  const start = async (input?: { text?: string; files?: PromptFile[] }): Promise<boolean> => {
    if (running.current) return false
    running.current = true
    setStarting(true)
    if (settings.uiSounds) playStartWorkSound(settings.volume)

    const text = input?.text?.trim()
    let switched = false
    try {
      await switchAgent.mutateAsync('build')
      switched = true
      if (text) {
        await sendPrompt.mutateAsync({ text, files: input?.files, delivery: 'steer' })
      } else {
        await sendSynthetic.mutateAsync({
          text: 'The user approved the plan. Start working on it.',
          description: 'User confirmed. Starting work.',
          metadata: claraEventMetadata('build-start'),
          delivery: 'steer',
          resume: true,
        })
      }
      return true
    } catch (cause) {
      if (isLocationRecoveryError(cause)) return false
      toast.error(
        switched
          ? 'Switched agents, but could not start work. Send a message from the reply box.'
          : 'Could not switch agents. Try again.'
      )
      return false
    } finally {
      running.current = false
      setStarting(false)
    }
  }

  return {
    start,
    pending: starting || switchAgent.isPending || sendSynthetic.isPending || sendPrompt.isPending,
  }
}
