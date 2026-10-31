import { ATTENTION_KINDS, type AttentionKind } from './attention'

export type NotificationSettings = {
  desktop: boolean
  sounds: boolean
  uiSounds: boolean
  volume: number
  soundKinds: Record<AttentionKind, boolean>
}

export const NOTIFICATION_SETTINGS_KEY = 'clara.notifications'

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktop: false,
  sounds: true,
  uiSounds: true,
  volume: 0.7,
  soundKinds: {
    review: true,
    question: true,
    plan: true,
    error: true,
  },
}

let cached: NotificationSettings | null = null
const listeners = new Set<() => void>()

function cloneDefaults(): NotificationSettings {
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    soundKinds: { ...DEFAULT_NOTIFICATION_SETTINGS.soundKinds },
  }
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalize(value: unknown): NotificationSettings {
  if (!value || typeof value !== 'object') return cloneDefaults()

  const record = value as Record<string, unknown>
  const rawKinds =
    record.soundKinds && typeof record.soundKinds === 'object'
      ? (record.soundKinds as Record<string, unknown>)
      : {}
  const soundKinds = {} as Record<AttentionKind, boolean>
  for (const kind of ATTENTION_KINDS) {
    soundKinds[kind] = readBoolean(rawKinds[kind], DEFAULT_NOTIFICATION_SETTINGS.soundKinds[kind])
  }

  const volume =
    typeof record.volume === 'number' && Number.isFinite(record.volume)
      ? Math.min(1, Math.max(0, record.volume))
      : DEFAULT_NOTIFICATION_SETTINGS.volume

  // Respect an existing muted sound preference when migrating old settings.
  const legacyUiSounds = readBoolean(record.sounds, DEFAULT_NOTIFICATION_SETTINGS.uiSounds)

  return {
    desktop: readBoolean(record.desktop, DEFAULT_NOTIFICATION_SETTINGS.desktop),
    sounds: readBoolean(record.sounds, DEFAULT_NOTIFICATION_SETTINGS.sounds),
    uiSounds: readBoolean(record.uiSounds, legacyUiSounds),
    volume,
    soundKinds,
  }
}

export function readNotificationSettings(): NotificationSettings {
  if (cached) return cached

  const raw = window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY)
  if (!raw) {
    cached = cloneDefaults()
    return cached
  }

  try {
    cached = normalize(JSON.parse(raw))
  } catch {
    cached = cloneDefaults()
  }
  return cached
}

export function saveNotificationSettings(next: NotificationSettings): void {
  cached = normalize(next)
  window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(cached))
  for (const listener of listeners) listener()
}

export function subscribeNotificationSettings(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== NOTIFICATION_SETTINGS_KEY) return
    cached = null
    readNotificationSettings()
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
