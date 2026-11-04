import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchiveRestore, Loader2, SquarePen, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SessionInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { DoneButton } from '@/components/chat/done-button'
import { useComposer } from '@/features/chat/composer-provider'
import { isArchivedSession } from '@/features/sessions/session-archive'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import { useDoneSession } from '@/features/sessions/use-session-archive'
import { useReopenSession } from '@/features/sessions/use-sessions'
import { useSessionWording } from '@/features/sessions/use-wording'
import { saveDraft } from '@/lib/storage'

/** Keep the Done celebration on screen for a beat before returning home. */
const DONE_REDIRECT_DELAY_MS = 600

export function ReplyActions({
  session,
  sessionID,
  projectID,
  busy,
  ready,
  empty,
  hasDraft,
  onDone,
  worker,
}: {
  session: SessionInfo
  sessionID: string
  projectID: string | undefined
  busy: boolean
  ready: boolean
  empty: boolean
  hasDraft: boolean
  onDone: () => void
  worker?: boolean
}) {
  const { mode, open } = useComposer()
  const [leaving, setLeaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const redirectTimer = useRef<number | undefined>(undefined)
  const previousMode = useRef(mode)
  const done = useDoneSession()
  const reopenSession = useReopenSession()
  const { singular, lowerSingular } = useSessionWording()
  const archived = isArchivedSession(session)
  const snoozed = isSnoozedSession(session)
  const canFinish = ready && !busy && !archived && !snoozed && !worker
  const canArchive = canFinish && !empty
  const canDeleteEmpty = canFinish && empty
  const canNew = canFinish && empty
  const canReopen = ready && !busy && (archived || snoozed)

  useEffect(() => {
    const wasOpen = previousMode.current !== 'closed'
    previousMode.current = mode
    if (wasOpen && mode === 'closed') {
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
  }, [mode])

  useEffect(
    () => () => {
      if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
    },
    []
  )

  const openPanel = () => {
    open({ target: { sessionID, projectID } })
  }

  const archiveSession = useCallback(() => {
    const pathAtClick = window.location.pathname
    setLeaving(true)
    done.mutate(
      { session, empty: false },
      {
        onSuccess: () => {
          toast.success(`${singular} complete`, { description: 'Nice work. On to the next one.' })
          if (redirectTimer.current) window.clearTimeout(redirectTimer.current)
          redirectTimer.current = window.setTimeout(() => {
            if (window.location.pathname === pathAtClick) onDone()
          }, DONE_REDIRECT_DELAY_MS)
        },
        onError: () => {
          setLeaving(false)
          toast.error(`Could not mark the ${lowerSingular} done`)
        },
      }
    )
  }, [done, lowerSingular, onDone, session, singular])

  const deleteEmpty = () => {
    if (done.isPending) return
    done.mutate(
      { session, empty: true },
      {
        onSuccess: () => {
          saveDraft(sessionID, '')
          toast.success('Empty draft deleted')
          onDone()
        },
        onError: () => toast.error('Could not delete the empty draft'),
      }
    )
  }

  const reopen = () => {
    reopenSession.mutate(
      { session },
      {
        onSuccess: () => toast.success(`${singular} reopened`),
        onError: () => toast.error(`Could not reopen the ${lowerSingular}`),
      }
    )
  }

  if (mode !== 'closed') return null

  return (
    <div className="absolute right-4 bottom-4 z-30 flex items-center gap-2 max-md:right-5 max-md:bottom-6">
      {(canArchive || leaving) && (
        <DoneButton pending={done.isPending || leaving} onConfirm={archiveSession} />
      )}

      {canReopen && !leaving && (
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={reopen}
          disabled={reopenSession.isPending}
          title={`Reopen ${lowerSingular}`}
          className="gap-2 rounded-full bg-background shadow-lg max-md:h-11"
        >
          {reopenSession.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArchiveRestore className="size-4" />
          )}
          Reopen
        </Button>
      )}

      {canDeleteEmpty && !leaving && (
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={deleteEmpty}
          disabled={done.isPending}
          title="Delete empty draft"
          className="gap-2 rounded-full bg-background text-destructive shadow-lg hover:text-destructive max-md:h-11"
        >
          {done.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Delete
        </Button>
      )}

      {!empty && !worker && (
        <Button
          ref={triggerRef}
          type="button"
          size="lg"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-expanded={false}
          title={hasDraft ? 'Reply (draft saved)' : 'Reply'}
          className="relative gap-2 rounded-full px-4 shadow-lg max-md:h-11"
        >
          <SquarePen className="size-4" />
          Reply
          {hasDraft && (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-primary" />
          )}
        </Button>
      )}

      {canNew && (
        <Button
          ref={triggerRef}
          type="button"
          size="lg"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-expanded={false}
          title={hasDraft ? 'New message (draft saved)' : 'New message'}
          className="relative gap-2 rounded-full px-4 shadow-lg max-md:h-11"
        >
          <SquarePen className="size-4" />
          New
          {hasDraft && (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-emerald-500 ring-2 ring-primary" />
          )}
        </Button>
      )}
    </div>
  )
}
