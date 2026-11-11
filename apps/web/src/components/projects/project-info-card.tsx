import { useState, type ReactNode } from 'react'
import { Archive, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClaraProject } from '@clara/api-contract'
import { ProjectAvatar } from '@/components/projects/project-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { projectAvatarSource } from '@/features/projects/project-avatar'
import { projectLabel } from '@/features/projects/project-list'
import {
  useArchiveProjectSessions,
  useDeleteProjectSessions,
} from '@/features/projects/use-project-actions'
import { useProjectStats } from '@/features/projects/use-project-stats'
import { useSessionWording } from '@/features/sessions/use-wording'
import { formatCount, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type ProjectAction = 'archive' | 'delete'

export function ProjectInfoCard({ project }: { project: ClaraProject }) {
  const [action, setAction] = useState<ProjectAction | null>(null)
  const statsQuery = useProjectStats(project.id)
  const archive = useArchiveProjectSessions(project.id)
  const remove = useDeleteProjectSessions(project.id)
  const { lowerPlural, lowerSingular } = useSessionWording()
  const stats = statsQuery.data
  const pending = archive.isPending || remove.isPending
  const label = projectLabel(project)

  const totalLabel = stats
    ? `${formatCount(stats.total)}${stats.truncated ? '+' : ''} ${stats.total === 1 ? lowerSingular : lowerPlural}`
    : `every ${lowerSingular}`

  const confirm = () => {
    if (action === 'archive') {
      archive.mutate(undefined, {
        onSuccess: (count) => {
          toast.success(
            count === 0
              ? 'No sessions needed archiving'
              : `Archived ${formatCount(count)} ${count === 1 ? lowerSingular : lowerPlural}`
          )
          setAction(null)
        },
        onError: () => toast.error('Could not archive the sessions'),
      })
      return
    }

    if (action === 'delete') {
      remove.mutate(undefined, {
        onSuccess: (count) => {
          toast.success(
            count === 0
              ? 'No sessions to delete'
              : `Deleted ${formatCount(count)} ${count === 1 ? lowerSingular : lowerPlural}`
          )
          setAction(null)
        },
        onError: () => toast.error('Could not delete the sessions'),
      })
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-start gap-3">
            <ProjectAvatar project={project} size="md" />
            <div className="min-w-0">
              <CardTitle className="text-sm">{label}</CardTitle>
              <CardDescription className="mt-0.5 truncate font-mono text-[11px]">
                {project.canonical}
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 max-md:size-11"
                  aria-label={`Actions for ${label}`}
                >
                  <MoreHorizontal className="size-4 max-md:size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={stats?.total === 0}
                  onSelect={() => setAction('archive')}
                >
                  <Archive className="size-3.5" /> Archive all {lowerPlural}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={stats?.total === 0}
                  onSelect={() => setAction('delete')}
                >
                  <Trash2 className="size-3.5" /> Delete all {lowerPlural}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {statsQuery.isPending ? (
              <>
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16" />
              </>
            ) : statsQuery.isError || !stats ? (
              <span className="text-xs text-muted-foreground">Session counts unavailable</span>
            ) : (
              <>
                <Badge variant="secondary">{formatCount(stats.active)} active</Badge>
                <Badge variant="outline" title="Archived sessions">
                  {formatCount(stats.archived)} inactive
                </Badge>
                <Badge variant="outline">
                  {formatCount(stats.total)}
                  {stats.truncated ? '+' : ''} total
                </Badge>
              </>
            )}
          </div>

          <Separator />

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <InfoRow label="Location" mono>
              {project.canonical}
            </InfoRow>
            <InfoRow label="ID" mono>
              {project.id}
            </InfoRow>
            <InfoRow label="VCS">{project.vcs ?? 'None'}</InfoRow>
            <InfoRow label="Icon">{iconDescription(project)}</InfoRow>
            <InfoRow label="Commands">
              {project.commands?.start?.trim() ? (
                <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
                  {project.commands.start.trim()}
                </code>
              ) : (
                'None'
              )}
            </InfoRow>
            <InfoRow label="Sandboxes">
              {project.sandboxes.length === 0 ? (
                'None'
              ) : (
                <span className="flex flex-wrap gap-1">
                  {project.sandboxes.map((sandbox) => (
                    <Badge
                      key={sandbox}
                      variant="outline"
                      className="max-w-full font-mono text-[10px]"
                    >
                      <span className="truncate">{sandbox}</span>
                    </Badge>
                  ))}
                </span>
              )}
            </InfoRow>
          </div>

          <Separator />

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <InfoRow label="Created">{formatDateTime(project.time.created)}</InfoRow>
            <InfoRow label="Updated">{formatDateTime(project.time.updated)}</InfoRow>
            <InfoRow label="Active">{formatDateTime(project.time.active)}</InfoRow>
            <InfoRow label="Archived">
              {project.time.archived ? formatDateTime(project.time.archived) : 'Not archived'}
            </InfoRow>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'archive' ? `Archive all ${lowerPlural}?` : `Delete all ${lowerPlural}?`}
            </DialogTitle>
            <DialogDescription>
              {action === 'archive'
                ? `This archives ${totalLabel} on the OpenCode server. The project itself is not archived and stays available.`
                : `This permanently deletes ${totalLabel} from the OpenCode server. The project record stays, but its sessions cannot be restored.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={action === 'delete' ? 'destructive' : 'default'}
              onClick={confirm}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {action === 'archive' ? 'Archive all' : 'Delete all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function iconDescription(project: ClaraProject): string {
  const source = projectAvatarSource(project)
  if (source.kind === 'image') {
    return source.src === project.icon?.override?.trim() ? 'Custom image' : 'Discovered favicon'
  }
  if (source.kind === 'color') return `Color: ${source.color}`
  return 'Default'
}

function InfoRow({
  label,
  mono,
  children,
}: {
  label: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('break-words text-sm', mono && 'font-mono text-xs')}>{children}</div>
    </div>
  )
}
