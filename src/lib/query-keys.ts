export const queryKeys = {
  projects: ['projects'] as const,
  sessions: (projectID: string | null) => ['sessions', projectID ?? 'all'] as const,
  archivedSessions: (projectID: string | null) =>
    ['sessions', projectID ?? 'all', 'archived'] as const,
  activeSessions: ['sessions', 'active'] as const,
  session: (sessionID: string) => ['session', sessionID] as const,
  messages: (sessionID: string) => ['messages', sessionID] as const,
  sessionInbox: (sessionID: string) => ['session-inbox', sessionID] as const,
  sessionMailbox: (sessionID: string) => ['session-mailbox', sessionID] as const,
  agents: ['agents'] as const,
  models: ['models'] as const,
  commands: ['commands'] as const,
  references: (directory: string | undefined) => ['references', directory ?? 'global'] as const,
  vcsInfo: (directory: string | undefined) => ['vcs', 'info', directory ?? 'global'] as const,
  vcsBase: (directory: string | undefined) => ['vcs', 'base', directory ?? 'global'] as const,
  vcsChanges: (directory: string | undefined, range: string, base: string | undefined) =>
    ['vcs', 'changes', directory ?? 'global', range, base ?? ''] as const,
  permissions: ['permissions'] as const,
  forms: (sessionID: string) => ['forms', sessionID] as const,
}
