import { useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import type { ClaraProject } from '@clara/api-contract'
import {
  projectAvatarSource,
  projectInitial,
  type ProjectAvatarColor,
  type ProjectAvatarSource,
} from '@/features/projects/project-avatar'
import { cn } from '@/lib/utils'

const SIZES = {
  xs: { box: 'size-5 rounded', icon: 'size-3', text: 'text-[10px]', ring: 'ring-1' },
  sm: { box: 'size-8 rounded-md', icon: 'size-4', text: 'text-sm', ring: 'ring-1' },
  md: { box: 'size-10 rounded-lg', icon: 'size-5', text: 'text-base', ring: 'ring-1' },
  lg: { box: 'size-16 rounded-xl', icon: 'size-7', text: 'text-2xl', ring: 'ring-1' },
} as const

type ProjectAvatarSize = keyof typeof SIZES

const COLOR_CLASSES: Record<ProjectAvatarColor, string> = {
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-950/70 dark:text-pink-200',
  mint: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-950/70 dark:text-orange-200',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-200',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/70 dark:text-cyan-200',
  lime: 'bg-lime-100 text-lime-800 dark:bg-lime-950/70 dark:text-lime-200',
}

function withOverrideRemoved(project: ClaraProject): ClaraProject {
  return { ...project, icon: { ...project.icon, override: '' } }
}

/**
 * Pick the first renderable source. If a custom image fails to load, try the
 * color or discovered favicon behind it before falling back to the folder.
 */
function resolveSource(project: ClaraProject, failed: ReadonlySet<string>): ProjectAvatarSource {
  const candidates = [
    projectAvatarSource(project),
    projectAvatarSource(withOverrideRemoved(project)),
  ]
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.kind !== 'image') return candidate
    if (failed.has(candidate.src) || seen.has(candidate.src)) continue
    seen.add(candidate.src)
    return candidate
  }

  return { kind: 'default' }
}

export function ProjectAvatar({
  project,
  size = 'md',
  className,
}: {
  project: ClaraProject
  size?: ProjectAvatarSize
  className?: string
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const source = resolveSource(project, failed)
  const dimensions = SIZES[size]

  if (source.kind === 'image') {
    return (
      <img
        src={source.src}
        alt=""
        aria-hidden
        className={cn(
          'shrink-0 object-cover ring-foreground/10',
          dimensions.box,
          dimensions.ring,
          className
        )}
        onError={() => {
          const src = source.src
          setFailed((current) => new Set(current).add(src))
        }}
      />
    )
  }

  if (source.kind === 'color') {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center font-semibold ring-foreground/10',
          dimensions.box,
          dimensions.ring,
          dimensions.text,
          COLOR_CLASSES[source.color],
          className
        )}
      >
        {projectInitial(project)}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-muted text-muted-foreground ring-foreground/10',
        dimensions.box,
        dimensions.ring,
        className
      )}
    >
      <FolderGit2 className={dimensions.icon} />
    </span>
  )
}
