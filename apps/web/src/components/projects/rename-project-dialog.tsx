import { useEffect, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClaraProject } from '@clara/api-contract'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { projectLabel } from '@/features/projects/project-list'
import { useUpdateProject } from '@/features/projects/use-projects'

export function RenameProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ClaraProject
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(project.name ?? '')
  const rename = useUpdateProject(project.id)

  useEffect(() => {
    if (open) setName(project.name ?? '')
  }, [open, project.name])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!value) return
    rename.mutate(
      { name: value },
      {
        onSuccess: () => {
          toast.success('Project renamed')
          onOpenChange(false)
        },
        onError: () => toast.error('Could not rename the project'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              This changes the name on the server for every Clara client. The directory stays{' '}
              {project.canonical}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor={`project-name-${project.id}`}
              className="text-xs font-medium text-foreground"
            >
              Project name
            </label>
            <Input
              id={`project-name-${project.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={projectLabel(project)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || rename.isPending}>
              {rename.isPending && <Loader2 className="size-4 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
