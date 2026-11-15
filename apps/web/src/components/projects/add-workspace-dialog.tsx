import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, Loader2, Server } from 'lucide-react'
import { toast } from 'sonner'
import type { ClaraProject } from '@clara/api-contract'
import { Button } from '@clara/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clara/ui/components/dialog'
import { Input } from '@clara/ui/components/input'
import { Label } from '@clara/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import {
  useAddProjectWorkspace,
  useAvailableProjects,
  useHarnesses,
} from '@/features/projects/use-projects'

export function AddWorkspaceDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ClaraProject
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const harnesses = useHarnesses()
  const add = useAddProjectWorkspace(project.id)
  const [harnessID, setHarnessID] = useState<string | undefined>(project.workspaces[0]?.harnessID)
  const [directory, setDirectory] = useState('')
  const [label, setLabel] = useState('')

  const available = useAvailableProjects(harnessID)
  const selectedHarness = harnesses.data?.find((harness) => harness.harnessID === harnessID)
  const initialHarnessID = useMemo(
    () =>
      project.workspaces[0]?.harnessID ??
      harnesses.data?.find((harness) => harness.online)?.harnessID ??
      harnesses.data?.[0]?.harnessID,
    [harnesses.data, project.workspaces]
  )

  useEffect(() => {
    if (!open) return
    setHarnessID(initialHarnessID)
    setDirectory('')
    setLabel('')
  }, [initialHarnessID, open])

  const submit = () => {
    const value = directory.trim()
    if (!harnessID || !value) return
    add.mutate(
      {
        harnessID,
        directory: value,
        ...(label.trim() ? { label: label.trim() } : {}),
      },
      {
        onSuccess: (updated) => {
          const workspace = updated.workspaces.find(
            (item) => item.directory === value && item.harnessID === harnessID
          )
          if (workspace?.linked) {
            toast.success(`Linked ${value}`)
          } else {
            toast.success(`Added ${value}`, {
              description: 'The workspace will link when its harness is online.',
            })
          }
          onOpenChange(false)
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'Could not add the workspace')
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="size-4" /> Add workspace
          </DialogTitle>
          <DialogDescription>
            Link a directory on a paired harness. The harness resolves its own canonical path.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Harness</Label>
            {harnesses.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading harnesses…
              </div>
            ) : (
              <Select value={harnessID} onValueChange={setHarnessID}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a harness" />
                </SelectTrigger>
                <SelectContent>
                  {(harnesses.data ?? []).map((harness) => (
                    <SelectItem key={harness.harnessID} value={harness.harnessID}>
                      {harness.label} {harness.online ? '' : '· offline'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedHarness && !selectedHarness.online && (
              <p className="text-[11px] text-muted-foreground">
                This harness is offline. The workspace is saved now and links when it reconnects.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-directory">Directory</Label>
            <Input
              id="workspace-directory"
              value={directory}
              placeholder="/path/on/the/harness"
              onChange={(event) => setDirectory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-label">Label (optional)</Label>
            <Input
              id="workspace-label"
              value={label}
              placeholder="Main checkout"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          {available.data && available.data.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium">Import an existing harness project</p>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-1">
                {available.data.map((candidate) => (
                  <button
                    key={`${candidate.harnessID}:${candidate.projectID}`}
                    type="button"
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                    onClick={() => {
                      setDirectory(candidate.canonical)
                      if (!label.trim() && candidate.name) setLabel(candidate.name)
                    }}
                  >
                    <Server className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs">
                        {candidate.name ?? candidate.canonical}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {candidate.canonical}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!harnessID || !directory.trim() || add.isPending}>
            {add.isPending && <Loader2 className="size-4 animate-spin" />}
            Add workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
