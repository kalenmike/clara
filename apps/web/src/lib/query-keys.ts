/** A stable key segment for a harness. Nothing is fetched without one. */
export function harnessKey(harnessID?: string): string {
  return harnessID ?? 'none'
}

export const queryKeys = {
  projects: ['projects'] as const,
  archivedProjects: ['projects', 'archived'] as const,
  harnesses: ['harnesses'] as const,
  projectAvailable: (harnessID?: string) => ['project-available', harnessKey(harnessID)] as const,
  sessions: (projectID: string | null) => ['sessions', projectID ?? 'all'] as const,
  archivedSessions: (projectID: string | null) =>
    ['sessions', projectID ?? 'all', 'archived'] as const,
  projectPresence: (projectID: string) => ['project-presence', projectID] as const,
  projectStats: (projectID: string | null) =>
    ['project-stats', projectID ?? 'all', 'project'] as const,
  activeSessions: ['sessions', 'active'] as const,
  activitySessions: ['activity', 'sessions'] as const,
  activityProjectSessions: (projectID: string | null) =>
    ['activity', 'sessions', projectID ?? 'all'] as const,
  session: (sessionID: string) => ['session', sessionID] as const,
  messages: (sessionID: string) => ['messages', sessionID] as const,
  sessionInbox: (sessionID: string) => ['session-inbox', sessionID] as const,
  sessionMailbox: (sessionID: string) => ['session-mailbox', sessionID] as const,
  agents: (harnessID?: string) => ['agents', harnessKey(harnessID)] as const,
  models: (harnessID?: string) => ['models', harnessKey(harnessID)] as const,
  providers: (harnessID?: string) => ['providers', harnessKey(harnessID)] as const,
  commands: (harnessID?: string) => ['commands', harnessKey(harnessID)] as const,
  skills: (directory: string | undefined, harnessID?: string) =>
    ['skills', directory ?? 'global', harnessKey(harnessID)] as const,
  references: (directory: string | undefined, harnessID?: string) =>
    ['references', directory ?? 'global', harnessKey(harnessID)] as const,
  vcsInfo: (directory: string | undefined, harnessID?: string) =>
    ['vcs', 'info', directory ?? 'global', harnessKey(harnessID)] as const,
  vcsBase: (directory: string | undefined, harnessID?: string) =>
    ['vcs', 'base', directory ?? 'global', harnessKey(harnessID)] as const,
  vcsChanges: (
    directory: string | undefined,
    range: string,
    base: string | undefined,
    harnessID?: string
  ) => ['vcs', 'changes', directory ?? 'global', range, base ?? '', harnessKey(harnessID)] as const,
  /**
   * Git history and worktrees use their own root. Invalidating `vcs` on every
   * file write must not spawn a `git log` shell job.
   */
  gitCommits: (
    directory: string | undefined,
    since: number | undefined,
    until: number | undefined,
    harnessID?: string
  ) =>
    [
      'git',
      'commits',
      directory ?? 'global',
      since ?? 0,
      until ?? 0,
      harnessKey(harnessID),
    ] as const,
  gitWorktrees: (
    projectID: string | undefined,
    directory: string | undefined,
    harnessID?: string
  ) =>
    [
      'git',
      'worktrees',
      projectID ?? 'global',
      directory ?? 'global',
      harnessKey(harnessID),
    ] as const,
  /** Prefix for invalidating pending permissions across every harness. */
  permissions: ['permissions'] as const,
  permissionsFor: (directory: string | undefined, harnessID?: string) =>
    ['permissions', directory ?? 'global', harnessKey(harnessID)] as const,
  forms: (sessionID: string) => ['forms', sessionID] as const,
}
