import { ATTENTION_KINDS, type AttentionKind } from './attention'

export type NotificationSettings = {
  desktop: boolean
  push: boolean
  sounds: boolean
  uiSounds: boolean
  volume: number
  soundKinds: Record<AttentionKind, boolean>
  /** How long a visible desktop window holds mobile push alerts after activity. */
  deskIdleMs: number
}

export const NOTIFICATION_SETTINGS_KEY = 'clara.notifications'

/** Offered by the settings card and used to clamp a stored value. */
export const DESK_IDLE_OPTIONS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]
export const DESK_IDLE_DEFAULT_MS = 5 * 60_000
const DESK_IDLE_MIN_MS = 60_000
const DESK_IDLE_MAX_MS = 60 * 60_000

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktop: false,
  push: false,
  sounds: true,
  uiSounds: true,
  volume: 0.7,
  soundKinds: {
    review: true,
    question: true,
    plan: true,
    error: true,
  },
  deskIdleMs: DESK_IDLE_DEFAULT_MS,
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

  const deskIdleMs =
    typeof record.deskIdleMs === 'number' && Number.isFinite(record.deskIdleMs)
      ? Math.min(DESK_IDLE_MAX_MS, Math.max(DESK_IDLE_MIN_MS, Math.round(record.deskIdleMs)))
      : DEFAULT_NOTIFICATION_SETTINGS.deskIdleMs

  // Respect an existing muted sound preference when migrating old settings.
  const legacyUiSounds = readBoolean(record.sounds, DEFAULT_NOTIFICATION_SETTINGS.uiSounds)

  return {
    desktop: readBoolean(record.desktop, DEFAULT_NOTIFICATION_SETTINGS.desktop),
    push: readBoolean(record.push, DEFAULT_NOTIFICATION_SETTINGS.push),
    sounds: readBoolean(record.sounds, DEFAULT_NOTIFICATION_SETTINGS.sounds),
    uiSounds: readBoolean(record.uiSounds, legacyUiSounds),
    volume,
    soundKinds,
    deskIdleMs,
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
