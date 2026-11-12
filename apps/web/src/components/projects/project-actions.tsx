import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Archive,
  ArchiveRestore,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Unplug,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  ClaraProject,
  ClaraProjectArchiveResult,
  ClaraProjectDeleteResult,
  ClaraProjectHarnessResult,
} from '@clara/api-contract'
import { AddWorkspaceDialog } from '@/components/projects/add-workspace-dialog'
import { RenameProjectDialog } from '@/components/projects/rename-project-dialog'
import { Button } from '@/components/ui/button'
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
import { projectLabel } from '@/features/projects/project-list'
import { useArchiveProject, useDeleteProject } from '@/features/projects/use-projects'

type ProjectDialog = 'archive' | 'unarchive' | 'delete' | 'disconnect'

export function ProjectActionsMenu({
  project,
  onDeleted,
}: {
  project: ClaraProject
  onDeleted?: () => void
}) {
  const navigate = useNavigate()
  const archive = useArchiveProject(project.id)
  const remove = useDeleteProject(project.id)
  const [renameOpen, setRenameOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [dialog, setDialog] = useState<ProjectDialog | null>(null)
  const label = projectLabel(project)
  const archived = project.time.archived !== undefined
  const pending = archive.isPending || remove.isPending

  const close = () => {
    if (!pending) setDialog(null)
  }

  const finishDelete = (harnesses: ClaraProjectHarnessResult[], keptHarnesses: boolean) => {
    const failed = harnesses.filter((item) => !item.ok)
    if (keptHarnesses && failed.length > 0) {
      toast.warning(`Removed ${label}`, {
        description: `${failed.length} harness${failed.length === 1 ? '' : 'es'} could not be reached; their data was left untouched.`,
      })
    } else {
      toast.success(`Removed ${label}`)
    }
    setDialog(null)
    if (onDeleted) onDeleted()
    else navigate('/projects')
  }

  const confirm = () => {
    if (dialog === 'archive' || dialog === 'unarchive') {
      const next = dialog === 'archive'
      archive.mutate(next, {
        onSuccess: (result: ClaraProjectArchiveResult) => {
          const failed = result.harnesses.filter((item) => !item.ok)
          toast.success(next ? `Archived ${label}` : `Restored ${label}`, {
            ...(failed.length > 0
              ? {
                  description: `${failed.length} harness${failed.length === 1 ? '' : 'es'} reported a problem.`,
                }
              : {}),
          })
          setDialog(null)
        },
        onError: () => toast.error('Could not change the project archive state'),
      })
      return
    }

    if (dialog === 'delete') {
      remove.mutate('propagate', {
        onSuccess: (result: ClaraProjectDeleteResult) => finishDelete(result.harnesses, true),
        onError: () => toast.error('Could not delete the project'),
      })
      return
    }

    remove.mutate('disconnect', {
      onSuccess: (result: ClaraProjectDeleteResult) => finishDelete(result.harnesses, false),
      onError: () => toast.error('Could not remove the project from Clara'),
    })
  }

  return (
    <>
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
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-3.5" /> Rename project
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setWorkspaceOpen(true)}>
            <FolderPlus className="size-3.5" /> Add workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog(archived ? 'unarchive' : 'archive')}>
            {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            {archived ? 'Restore project' : 'Archive project'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 className="size-3.5" /> Delete project…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('disconnect')}>
            <Unplug className="size-3.5" /> Remove from Clara…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog project={project} open={renameOpen} onOpenChange={setRenameOpen} />
      <AddWorkspaceDialog project={project} open={workspaceOpen} onOpenChange={setWorkspaceOpen} />

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? undefined : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle(dialog, label)}</DialogTitle>
            <DialogDescription>{dialogDescription(dialog, label)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={dialog === 'delete' || dialog === 'disconnect' ? 'destructive' : 'default'}
              onClick={confirm}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {dialogAction(dialog, archived)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function dialogTitle(dialog: ProjectDialog | null, label: string): string {
  switch (dialog) {
    case 'archive':
      return `Archive ${label}?`
    case 'unarchive':
      return `Restore ${label}?`
    case 'delete':
      return `Delete ${label}?`
    case 'disconnect':
      return `Remove ${label} from Clara?`
    default:
      return ''
  }
}

function dialogDescription(dialog: ProjectDialog | null, label: string): string {
  switch (dialog) {
    case 'archive':
      return `Clara hides ${label} and asks every linked harness to archive its project data. For the included OpenCode adapter this archives every session in the linked project records.`
    case 'unarchive':
      return `Clara shows ${label} again and asks every linked harness to unarchive its project data.`
    case 'delete':
      return `Clara deletes ${label} and asks every linked harness to delete its project data. For the included OpenCode adapter this permanently deletes every session in the linked project records; the harness project record may remain.`
    case 'disconnect':
      return `Clara removes ${label} and its workspace links. Harness projects and sessions stay untouched.`
    default:
      return ''
  }
}

function dialogAction(dialog: ProjectDialog | null, archived: boolean): string {
  if (dialog === 'unarchive') return 'Restore project'
  if (dialog === 'archive') return 'Archive project'
  if (dialog === 'delete') return 'Delete project'
  if (dialog === 'disconnect') return 'Remove from Clara'
  return archived ? 'Restore' : 'Confirm'
}
