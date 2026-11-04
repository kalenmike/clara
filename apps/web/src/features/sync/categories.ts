export const SYNC_CATEGORIES = [
  'theme',
  'preferences',
  'notifications',
  'project',
  'inbox',
] as const

export type SyncCategory = (typeof SYNC_CATEGORIES)[number]

export type SyncCategoryInfo = {
  id: SyncCategory
  label: string
  description: string
}

export const SYNC_CATEGORY_INFO: SyncCategoryInfo[] = [
  {
    id: 'theme',
    label: 'Theme',
    description: 'Light or dark mode and the color palette.',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description:
      'Default agent, last used agent, session wording, and hidden model providers or models.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description:
      'Alert sounds, volume, and the desk idle window. Browser permission and push subscriptions stay on this device.',
  },
  {
    id: 'project',
    label: 'Project',
    description: 'Last selected project and whether empty projects show.',
  },
  {
    id: 'inbox',
    label: 'Inbox monitor',
    description: 'Whether the Inbox monitor is active.',
  },
]
