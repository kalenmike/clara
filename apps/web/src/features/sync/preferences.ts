import { SYNC_CATEGORIES, type SyncCategory } from './categories'

export const SYNC_PREFERENCES_KEY = 'clara.sync'

export type SyncPreferences = {
  categories: Record<SyncCategory, boolean>
  /** The last namespace revision applied on this client. */
  revision: number | null
  /** Keys changed locally that the server has not accepted yet. */
  dirty: string[]
}

export const DEFAULT_SYNC_PREFERENCES: SyncPreferences = {
  categories: {
    theme: false,
    preferences: false,
    models: false,
    notifications: false,
    project: false,
    inbox: false,
  },
  revision: null,
  dirty: [],
}

let cached: SyncPreferences | null = null
const listeners = new Set<() => void>()

function cloneDefaults(): SyncPreferences {
  return {
    categories: { ...DEFAULT_SYNC_PREFERENCES.categories },
    revision: null,
    dirty: [],
  }
}

function normalize(value: unknown): SyncPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneDefaults()

  const record = value as Record<string, unknown>
  const rawCategories =
    record.categories && typeof record.categories === 'object' && !Array.isArray(record.categories)
      ? (record.categories as Record<string, unknown>)
      : {}
  const categories = {} as Record<SyncCategory, boolean>
  for (const category of SYNC_CATEGORIES) {
    categories[category] = rawCategories[category] === true
  }

  const revision =
    typeof record.revision === 'number' &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0
      ? record.revision
      : null

  const dirty = Array.isArray(record.dirty)
    ? Array.from(
        new Set(
          record.dirty.filter((key): key is string => typeof key === 'string' && key.length > 0)
        )
      )
    : []

  return { categories, revision, dirty }
}

export function readSyncPreferences(): SyncPreferences {
  if (cached) return cached

  try {
    const raw = window.localStorage.getItem(SYNC_PREFERENCES_KEY)
    cached = raw ? normalize(JSON.parse(raw)) : cloneDefaults()
  } catch {
    cached = cloneDefaults()
  }

  return cached
}

export function saveSyncPreferences(next: SyncPreferences): void {
  cached = normalize(next)

  try {
    window.localStorage.setItem(SYNC_PREFERENCES_KEY, JSON.stringify(cached))
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
}

export function updateSyncPreferences(
  update: (current: SyncPreferences) => SyncPreferences
): SyncPreferences {
  const next = normalize(update(readSyncPreferences()))
  saveSyncPreferences(next)
  return next
}

export function subscribeSyncPreferences(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SYNC_PREFERENCES_KEY) return
    cached = null
    readSyncPreferences()
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
