/**
 * The composer lives inside a chat and keeps one tab per session the person
 * has worked in. A tab stays only when its composer has input; closing it keeps
 * the local draft but removes the shortcut back to it.
 */
export type ComposerMode = 'pinned' | 'maximized' | 'minimized'

export type ComposerTarget = {
  sessionID: string
  projectID?: string
}

export function routeComposerTarget(
  projectID: string | undefined,
  sessionID: string | undefined
): ComposerTarget | null {
  if (!sessionID) return null
  return { sessionID, projectID }
}

export function composerReturnPath(target: ComposerTarget | null): string | null {
  if (!target?.projectID) return null
  return `/p/${target.projectID}/s/${target.sessionID}`
}

export function composerSessionTitle(title: string | undefined, lowerSingular: string): string {
  const trimmed = title?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : `Untitled ${lowerSingular}`
}
