export const queryKeys = {
  projects: ['projects'] as const,
  sessions: (directory: string | null) => ['sessions', directory ?? 'all'] as const,
  activeSessions: ['sessions', 'active'] as const,
  session: (sessionID: string) => ['session', sessionID] as const,
  messages: (sessionID: string) => ['messages', sessionID] as const,
  agents: ['agents'] as const,
  models: ['models'] as const,
  commands: ['commands'] as const,
  references: (directory: string | undefined) => ['references', directory ?? 'global'] as const,
  permissions: ['permissions'] as const,
  forms: (sessionID: string) => ['forms', sessionID] as const,
}
