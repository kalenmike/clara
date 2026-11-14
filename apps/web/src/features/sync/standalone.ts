/**
 * Settings that sync on their own, outside the category groups. Each one is a
 * deliberate single-value share rather than part of a broader preference set.
 */
export const SYNC_STANDALONE = ['orchestratorMode'] as const

export type SyncStandalone = (typeof SYNC_STANDALONE)[number]

export type SyncStandaloneInfo = {
  id: SyncStandalone
  label: string
  description: string
}

export const SYNC_STANDALONE_INFO: SyncStandaloneInfo[] = [
  {
    id: 'orchestratorMode',
    label: 'Orchestrator mode',
    description: 'Shares only the choice to use the orchestrator surface, not any other setting.',
  },
]
