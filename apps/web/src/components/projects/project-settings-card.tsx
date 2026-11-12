import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Check, ImagePlus, Loader2, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClaraProject } from '@clara/api-contract'
import { ProjectAvatar } from '@/components/projects/project-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PROJECT_AVATAR_COLORS,
  isProjectAvatarColor,
  type ProjectAvatarColor,
} from '@/features/projects/project-avatar'
import { ProjectIconError, projectIconDataURL } from '@/features/projects/project-icon'
import { useUpdateProject } from '@/features/projects/use-projects'
import { cn } from '@/lib/utils'

const COLOR_SWATCHES: Record<ProjectAvatarColor, string> = {
  pink: 'bg-pink-500',
  mint: 'bg-emerald-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  cyan: 'bg-cyan-500',
  lime: 'bg-lime-500',
}

type BusyAction = 'icon' | 'color' | 'command' | null

export function ProjectSettingsCard({ project }: { project: ClaraProject }) {
  const update = useUpdateProject(project.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const commandID = useId()
  const commandHintID = useId()
  const [busy, setBusy] = useState<BusyAction>(null)
  const [preview, setPreview] = useState<string | undefined>(project.icon?.override)
  const [colorPreview, setColorPreview] = useState<ProjectAvatarColor | null | undefined>(undefined)
  const [command, setCommand] = useState(project.commands?.start ?? '')

  const savedCommand = project.commands?.start ?? ''
  const color = colorPreview === undefined ? project.icon?.color : (colorPreview ?? '')
  const override = preview ?? ''
  const activeColor = isProjectAvatarColor(color) ? color : null
  const hasOverride = Boolean(override.trim())
  const commandDirty = command.trim() !== savedCommand.trim()

  useEffect(() => {
    setPreview(project.icon?.override)
    setColorPreview(undefined)
  }, [project.id, project.icon?.override, project.icon?.color])

  useEffect(() => {
    setCommand(savedCommand)
  }, [project.id, savedCommand])

  const avatarProject: ClaraProject = {
    ...project,
    icon: { ...project.icon, override, color },
  }

  const chooseFile = () => fileInput.current?.click()

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy('icon')
    try {
      const dataURL = await projectIconDataURL(file)
      setPreview(dataURL)
      await update.mutateAsync({
        icon: { override: dataURL, color: project.icon?.color },
      })
      toast.success('Project icon updated')
    } catch (error) {
      setPreview(project.icon?.override)
      toast.error(
        error instanceof ProjectIconError ? error.message : 'Could not save the project icon'
      )
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const removeIcon = () => {
    setBusy('icon')
    setPreview('')
    update.mutate(
      { icon: { override: '', color: project.icon?.color } },
      {
        onSuccess: () => toast.success('Custom icon removed'),
        onError: () => {
          setPreview(project.icon?.override)
          toast.error('Could not remove the icon')
        },
        onSettled: () => setBusy(null),
      }
    )
  }

  const chooseColor = (next: ProjectAvatarColor | null) => {
    if (busy || next === activeColor) return
    setBusy('color')
    setColorPreview(next)
    update.mutate(
      { icon: { override: project.icon?.override, color: next ?? '' } },
      {
        onSuccess: () =>
          toast.success(next ? `Avatar color set to ${next}` : 'Avatar color cleared'),
        onError: () => {
          setColorPreview(undefined)
          toast.error('Could not save the avatar color')
        },
        onSettled: () => setBusy(null),
      }
    )
  }

  const saveCommand = (event: FormEvent) => {
    event.preventDefault()
    const start = command.trim()
    if (!commandDirty || busy) return
    setBusy('command')
    update.mutate(
      { commands: { start } },
      {
        onSuccess: () => toast.success(start ? 'Startup script saved' : 'Startup script cleared'),
        onError: () => toast.error('Could not save the startup script'),
        onSettled: () => setBusy(null),
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings2 className="size-4" /> Project settings
        </CardTitle>
        <CardDescription>
          Saved in Clara and shared with every client connected to this hub.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <ProjectAvatar project={avatarProject} size="lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-sm font-medium">Project icon</p>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, WebP, GIF, or SVG. Square, 128×128 recommended.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-md:h-11"
                disabled={busy !== null}
                onClick={chooseFile}
              >
                {busy === 'icon' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="size-3.5" />
                )}
                {hasOverride ? 'Replace image' : 'Choose image'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="max-md:h-11"
                disabled={busy !== null || !hasOverride}
                onClick={removeIcon}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              A custom image is saved in the same field the harness edits. Removing it reveals the
              project's favicon or color.
            </p>
          </div>
        </div>

        {!hasOverride && (
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">Avatar color</p>
              <p className="text-xs text-muted-foreground">
                Used when there is no custom image. A color hides the favicon the harness discovered
                for this project; clearing it brings the favicon back.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant={activeColor ? 'outline' : 'secondary'}
                size="sm"
                className="max-md:h-11"
                aria-pressed={!activeColor}
                disabled={busy !== null}
                onClick={() => chooseColor(null)}
              >
                Default
              </Button>
              {PROJECT_AVATAR_COLORS.map((swatch) => {
                const selected = activeColor === swatch
                return (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Use ${swatch} for the project avatar`}
                    aria-pressed={selected}
                    disabled={busy !== null}
                    onClick={() => chooseColor(swatch)}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full outline-none transition-shadow',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'disabled:pointer-events-none disabled:opacity-50 max-md:size-11',
                      COLOR_SWATCHES[swatch],
                      selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                    )}
                  >
                    {selected && <Check className="size-4 text-white" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <form onSubmit={saveCommand} className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={commandID}>Workspace startup script</Label>
            <p id={commandHintID} className="text-xs text-muted-foreground">
              Runs after the harness creates a new workspace (worktree). Clara does not create
              worktrees today.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={commandID}
              value={command}
              aria-describedby={commandHintID}
              placeholder="e.g. pnpm install"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              className="font-mono text-xs max-md:h-11"
              onChange={(event) => setCommand(event.target.value)}
            />
            <Button
              type="submit"
              className="max-md:h-11 max-md:w-full"
              disabled={!commandDirty || busy !== null}
            >
              {busy === 'command' && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
