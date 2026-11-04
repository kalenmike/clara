/**
 * The composer is a window of its own: while it is open or minimized it keeps
 * the session it was opened for, even when the route moves to another session.
 * Closing it makes the current route's session the next target.
 */
export type ComposerMode = 'closed' | 'normal' | 'minimized' | 'maximized'

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

export function composerOpenTarget(input: {
  mode: ComposerMode
  route: ComposerTarget | null
  current: ComposerTarget | null
  explicit?: ComposerTarget | null
}): ComposerTarget | null {
  if (input.explicit) return input.explicit
  if (input.mode === 'closed') return input.route
  return input.current ?? input.route
}

export function isComposerDetached(
  target: ComposerTarget | null,
  routeSessionID: string | undefined
): boolean {
  return target != null && target.sessionID !== routeSessionID
}

export function composerReturnPath(target: ComposerTarget | null): string | null {
  if (!target?.projectID) return null
  return `/p/${target.projectID}/s/${target.sessionID}`
}

export function composerSessionTitle(title: string | undefined, lowerSingular: string): string {
  const trimmed = title?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : `Untitled ${lowerSingular}`
}

export function composerConnectionLabel(detached: boolean, lowerSingular: string): string {
  return detached ? `Draft for another ${lowerSingular}` : `Draft for this ${lowerSingular}`
}
