import type { Project } from '@opencode/client'
import { projectLabel } from '@/features/projects/project-list'

/** The palette keys OpenCode accepts for a generated project avatar. */
export const PROJECT_AVATAR_COLORS = ['pink', 'mint', 'orange', 'purple', 'cyan', 'lime'] as const

export type ProjectAvatarColor = (typeof PROJECT_AVATAR_COLORS)[number]

export type ProjectAvatarSource =
  | { kind: 'image'; src: string }
  | { kind: 'color'; color: ProjectAvatarColor }
  | { kind: 'default' }

export function isProjectAvatarColor(value: unknown): value is ProjectAvatarColor {
  return typeof value === 'string' && PROJECT_AVATAR_COLORS.includes(value as ProjectAvatarColor)
}

/**
 * Only render sources that are safe to place in an image tag. OpenCode stores
 * data URLs for both the user's icon and its discovered favicon.
 */
function imageSource(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/')
  ) {
    return trimmed
  }
  return null
}

/**
 * Mirror OpenCode's precedence: a custom image wins, then an explicit palette
 * color, then the favicon the server discovered in the project. A color
 * intentionally hides the discovered favicon until the color is cleared.
 */
export function projectAvatarSource(project: Project): ProjectAvatarSource {
  const override = imageSource(project.icon?.override)
  if (override) return { kind: 'image', src: override }

  if (isProjectAvatarColor(project.icon?.color)) {
    return { kind: 'color', color: project.icon.color }
  }

  const url = imageSource(project.icon?.url)
  if (url) return { kind: 'image', src: url }

  return { kind: 'default' }
}

/** The first character of the project label, used by color avatars. */
export function projectInitial(project: Project): string {
  const label = projectLabel(project)
  return Array.from(label)[0]?.toUpperCase() ?? '?'
}
