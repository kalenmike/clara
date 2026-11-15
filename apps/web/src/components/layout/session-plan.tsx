import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClaraSessionMessage } from '@clara/api-contract'
import { ListTodo, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PlanTodoList } from '@/components/chat/plan-todo-list'
import { Button } from '@clara/ui/components/button'
import { isLocationRecoveryError } from '@/features/chat/location-recovery'
import {
  findLatestPlanRequest,
  planRequestProgress,
  type PlanRequest,
} from '@/features/chat/plan-request'
import type { PlanTodo } from '@/features/chat/session-plan'
import { claraEventMetadata } from '@/features/chat/system-events'
import { useSendSynthetic } from '@/features/chat/use-chat'
import { useSessionWording } from '@/features/sessions/use-wording'

/** Idle requests may set up a plan without starting work. */
const PLAN_REQUEST =
  'Create a short todo list for this task with todowrite. Do not implement or explain.'
/** A running agent keeps going after refreshing its checklist. */
const PLAN_REQUEST_BUSY =
  'Create a todo list for the current task with todowrite, then continue the current work. Do not stop.'
const UPDATE_REQUEST = 'Refresh the todo list with the current plan and progress. Do not explain.'
const UPDATE_REQUEST_BUSY =
  'Refresh the todo list with current progress, then continue the current work. Do not stop.'

export function SessionPlan({
  sessionID,
  todos,
  messages,
  draft,
  busy,
}: {
  sessionID: string
  todos: PlanTodo[] | undefined
  messages: ClaraSessionMessage[]
  draft: boolean
  busy: boolean
}) {
  const [submitting, setSubmitting] = useState<'plan' | 'update' | null>(null)
  const [requested, setRequested] = useState<PlanRequest | null>(null)
  const [sawBusy, setSawBusy] = useState(false)
  const inFlight = useRef(false)
  const sendSynthetic = useSendSynthetic(sessionID)
  const { lowerSingular } = useSessionWording()
  const list = todos ?? []
  const hasPlan = list.length > 0
  const done = list.filter((todo) => todo.status === 'completed').length

  const latest = useMemo(() => findLatestPlanRequest(messages), [messages])
  const activeRequest = latest && (!requested || latest.time >= requested.time) ? latest : requested
  const progress = activeRequest ? planRequestProgress(messages, activeRequest) : 'responded'
  const inTranscript = Boolean(activeRequest && latest?.id === activeRequest.id)
  const stopped = !busy && (inTranscript || sawBusy)
  const awaiting = progress === 'waiting' && !stopped
  const pending = sendSynthetic.isPending || submitting !== null || awaiting

  useEffect(() => {
    if (busy) setSawBusy(true)
  }, [busy])

  const request = async () => {
    if (!sessionID || pending || inFlight.current) return
    inFlight.current = true
    const kind = hasPlan ? 'update' : 'plan'
    setSubmitting(kind)
    setSawBusy(busy)
    try {
      const result = await sendSynthetic.mutateAsync({
        text:
          kind === 'update'
            ? busy
              ? UPDATE_REQUEST_BUSY
              : UPDATE_REQUEST
            : busy
              ? PLAN_REQUEST_BUSY
              : PLAN_REQUEST,
        description: kind === 'update' ? 'Requested a plan update' : 'Requested a plan',
        metadata: claraEventMetadata(kind === 'update' ? 'plan-update' : 'plan-request'),
        delivery: 'steer',
        resume: true,
      })
      setRequested({ id: result.id, time: result.time.created })
    } catch (cause) {
      if (isLocationRecoveryError(cause)) return
      toast.error(
        kind === 'update'
          ? 'Could not request an update. Try again.'
          : 'Could not request a plan. Try again.'
      )
    } finally {
      inFlight.current = false
      setSubmitting(null)
    }
  }

  return (
    <section aria-label="Plan" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          <ListTodo className="size-3.5 text-muted-foreground" /> Plan
        </div>
        {hasPlan && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {done}/{list.length}
          </span>
        )}
      </div>

      {draft ? (
        <p className="text-[10px] text-muted-foreground">
          Send your {lowerSingular} to view the plan.
        </p>
      ) : (
        <>
          {hasPlan ? (
            <PlanTodoList todos={list} />
          ) : (
            <p className="text-[10px] text-muted-foreground">No plan yet.</p>
          )}

          <Button
            type="button"
            size="sm"
            variant={hasPlan ? 'outline' : 'secondary'}
            className="h-7 w-full gap-1 text-[11px] max-md:h-11 max-md:text-sm"
            onClick={() => void request()}
            disabled={pending || !sessionID}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : hasPlan ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <ListTodo className="size-3.5" />
            )}
            {pending ? 'Requesting…' : hasPlan ? 'Request Update' : 'Request Plan'}
          </Button>
        </>
      )}
    </section>
  )
}
