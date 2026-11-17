import { Fragment, type ReactNode } from 'react'
import type { ClaraSession } from '@clara/api-contract'
import { AlarmClock, AlarmClockOff, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@clara/ui/components/context-menu'
import { sessionMenuEntries, type SessionMenuAction } from '@/features/sessions/session-menu'
import { isSnoozedSession } from '@/features/sessions/session-snooze'
import {
  useArchiveSession,
  useReopenSession,
  useSnoozeSession,
} from '@/features/sessions/use-sessions'
import { useSessionWording } from '@/features/sessions/use-wording'

function menuIcon(action: SessionMenuAction) {
  switch (action) {
    case 'snooze':
      return <AlarmClock />
    case 'unsnooze':
      return <AlarmClockOff />
    case 'archive':
      return <Archive />
    case 'reopen':
      return <ArchiveRestore />
    case 'delete':
      return <Trash2 />
  }
}

/**
 * Clara's own right-click menu for a sidebar session. The desktop webview would
 * otherwise show its link menu (Open Link, Download Linked File, …).
 */
export function SidebarSessionContextMenu({
  session,
  onRequestDelete,
  children,
}: {
  session: ClaraSession
  onRequestDelete: (session: ClaraSession) => void
  children: ReactNode
}) {
  const { singular, lowerSingular } = useSessionWording()
  const snooze = useSnoozeSession()
  const archive = useArchiveSession(session.id)
  const reopen = useReopenSession()
  const snoozed = isSnoozedSession(session)

  const run = (action: SessionMenuAction) => {
    switch (action) {
      case 'snooze':
      case 'unsnooze':
        snooze.mutate(
          { session, snoozed: action === 'snooze' },
          {
            onSuccess: () =>
              toast.success(snoozed ? `${singular} unsnoozed` : `${singular} snoozed`),
            onError: () =>
              toast.error(
                snoozed
                  ? `Could not unsnooze the ${lowerSingular}`
                  : `Could not snooze the ${lowerSingular}`
              ),
          }
        )
        return
      case 'archive':
        archive.mutate(true, {
          onSuccess: () => toast.success(`${singular} archived`),
          onError: () => toast.error(`Could not archive the ${lowerSingular}`),
        })
        return
      case 'reopen':
        reopen.mutate(
          { session },
          {
            onSuccess: () => toast.success(`${singular} reopened`),
            onError: () => toast.error(`Could not reopen the ${lowerSingular}`),
          }
        )
        return
      case 'delete':
        onRequestDelete(session)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {sessionMenuEntries(session, { lowerSingular }).map((entry) => (
          <Fragment key={entry.action}>
            {entry.destructive && <ContextMenuSeparator />}
            <ContextMenuItem
              variant={entry.destructive ? 'destructive' : 'default'}
              onSelect={() => run(entry.action)}
            >
              {menuIcon(entry.action)}
              {entry.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
