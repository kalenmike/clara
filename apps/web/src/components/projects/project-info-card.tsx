import { useState, type ReactNode } from 'react'
import { FolderPlus, Loader2, RefreshCw, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClaraProject, ClaraProjectWorkspace } from '@clara/api-contract'
import { AddWorkspaceDialog } from '@/components/projects/add-workspace-dialog'
import { ProjectActionsMenu } from '@/components/projects/project-actions'
import { ProjectAvatar } from '@/components/projects/project-avatar'
import { Badge } from '@clara/ui/components/badge'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clara/ui/components/dialog'
import { Separator } from '@clara/ui/components/separator'
import { Skeleton } from '@clara/ui/components/skeleton'
import { projectLabel, projectWorkspaceSummary } from '@/features/projects/project-list'
import { describePartialHarnesses } from '@/features/projects/project-stats'
import {
  useRemoveProjectWorkspace,
  useSyncProject,
  useUpdateProject,
} from '@/features/projects/use-projects'
import { useProjectStats } from '@/features/projects/use-project-stats'
import { useSessionWording } from '@/features/sessions/use-wording'
import { formatCount, formatDateTime } from '@/lib/format'
import { cn } from '@clara/ui/lib/utils'

export function ProjectInfoCard({ project }: { project: ClaraProject }) {
  const statsQuery = useProjectStats(project.id)
  const update = useUpdateProject(project.id)
  const sync = useSyncProject(project.id)
  const removeWorkspace = useRemoveProjectWorkspace(project.id)
  const { lowerPlural } = useSessionWording()
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [removing, setRemoving] = useState<ClaraProjectWorkspace | null>(null)
  const stats = statsQuery.data
  const pending = update.isPending || sync.isPending || removeWorkspace.isPending
  const label = projectLabel(project)
  const archived = project.time.archived !== undefined

  const setDefault = (workspaceID: string) => {
    update.mutate(
      { defaultWorkspaceID: workspaceID },
      {
        onSuccess: () => toast.success('Default workspace updated'),
        onError: () => toast.error('Could not change the default workspace'),
      }
    )
  }

  const confirmRemove = () => {
    if (!removing) return
    removeWorkspace.mutate(removing.id, {
      onSuccess: () => {
        toast.success('Workspace removed from Clara')
        setRemoving(null)
      },
      onError: () => toast.error('Could not remove the workspace'),
    })
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
                {projectWorkspaceSummary(project)}
              </CardDescription>
            </div>
          </div>
          <CardAction className="flex items-center gap-1">
            <ProjectActionsMenu project={project} />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {archived && <Badge variant="outline">Archived</Badge>}
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
                {stats.partial && (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground"
                    title={describePartialHarnesses(stats.harnesses)}
                  >
                    partial
                  </Badge>
                )}
              </>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Workspaces</p>
                <p className="text-xs text-muted-foreground">
                  Each workspace is a directory on one harness.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                >
                  {sync.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Sync
                </Button>
                <Button variant="outline" size="sm" onClick={() => setWorkspaceOpen(true)}>
                  <FolderPlus className="size-3.5" /> Add
                </Button>
              </div>
            </div>

            {project.workspaces.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm">This project has no workspaces yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add a directory on a paired harness before creating {lowerPlural}.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setWorkspaceOpen(true)}
                >
                  <FolderPlus className="size-3.5" /> Add workspace
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {project.workspaces.map((workspace) => (
                  <WorkspaceRow
                    key={workspace.id}
                    workspace={workspace}
                    isDefault={project.defaultWorkspaceID === workspace.id}
                    disabled={pending}
                    onDefault={() => setDefault(workspace.id)}
                    onRemove={() => setRemoving(workspace)}
                  />
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <InfoRow label="ID" mono>
              {project.id}
            </InfoRow>
            <InfoRow label="Commands">
              {project.commands?.start?.trim() ? (
                <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
                  {project.commands.start.trim()}
                </code>
              ) : (
                'None'
              )}
            </InfoRow>
          </div>

          <Separator />

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <InfoRow label="Created">{formatDateTime(project.time.created)}</InfoRow>
            <InfoRow label="Updated">{formatDateTime(project.time.updated)}</InfoRow>
            <InfoRow label="Active">{formatDateTime(project.time.active)}</InfoRow>
            <InfoRow label="Archived">
              {project.time.archived ? formatDateTime(project.time.archived) : 'Not archived'}
            </InfoRow>
            <InfoRow label="Default workspace">
              {project.workspaces.find((item) => item.id === project.defaultWorkspaceID)?.label ??
                'First workspace'}
            </InfoRow>
            <InfoRow label="Sessions">
              {stats
                ? `${formatCount(stats.total)}${stats.truncated ? '+' : ''} ${lowerPlural}`
                : `— ${lowerPlural}`}
            </InfoRow>
          </div>
        </CardContent>
      </Card>

      <AddWorkspaceDialog project={project} open={workspaceOpen} onOpenChange={setWorkspaceOpen} />

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this workspace?</DialogTitle>
            <DialogDescription>
              {removing?.directory} is removed from this Clara project. The harness project and its
              sessions stay untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoving(null)}
              disabled={removeWorkspace.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRemove}
              disabled={removeWorkspace.isPending}
            >
              {removeWorkspace.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WorkspaceRow({
  workspace,
  isDefault,
  disabled,
  onDefault,
  onRemove,
}: {
  workspace: ClaraProjectWorkspace
  isDefault: boolean
  disabled: boolean
  onDefault: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {workspace.harnessLabel || workspace.harnessKind || 'Harness'}
          </Badge>
          {isDefault && (
            <Badge variant="outline" className="text-[10px]">
              <Star className="size-2.5" /> Default
            </Badge>
          )}
          <Badge
            variant={workspace.online ? 'outline' : 'secondary'}
            className={cn('text-[10px]', !workspace.online && 'text-muted-foreground')}
          >
            {workspace.online ? 'online' : 'offline'}
          </Badge>
          {!workspace.linked && (
            <Badge variant="secondary" className="text-[10px]">
              unresolved
            </Badge>
          )}
        </div>
        <p
          className="truncate font-mono text-[11px]"
          title={workspace.canonical ?? workspace.directory}
        >
          {workspace.canonical ?? workspace.directory}
        </p>
        {workspace.label && (
          <p className="truncate text-[11px] text-muted-foreground">{workspace.label}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isDefault && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={disabled}
            onClick={onDefault}
            aria-label="Set as default workspace"
            title="Set as default workspace"
          >
            <Star className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove workspace"
          title="Remove workspace from Clara"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
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
