import {
  AGENT_DEFAULT_KEY,
  LAST_AGENT_KEY,
  readDefaultAgent,
  saveDefaultAgent,
  saveLastAgent,
} from '@/features/agents/default-agent'
import { ATTENTION_KINDS } from '@/features/notifications/attention'
import {
  NOTIFICATION_SETTINGS_KEY,
  readNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from '@/features/notifications/settings'
import {
  COST_DISPLAY_KEY,
  isCostDisplaySource,
  saveCostDisplay,
} from '@/features/cost/cost-display'
import {
  HIDDEN_MODELS_KEY,
  normalizeHiddenModels,
  readHiddenModels,
  saveHiddenModels,
} from '@/features/models/visibility'
import {
  SHOW_ARCHIVED_PROJECTS_KEY,
  saveShowArchivedProjects,
} from '@/features/projects/show-archived-projects'
import {
  SHOW_EMPTY_PROJECTS_KEY,
  saveShowEmptyProjects,
} from '@/features/projects/show-empty-projects'
import {
  SESSION_WORDING_KEY,
  readSessionWording,
  saveSessionWording,
} from '@/features/sessions/wording'
import { COLOR_THEME_KEY, isColorTheme, saveColorTheme } from '@/features/theme/color-theme'
import {
  LAST_PROJECT_KEY,
  MONITOR_INBOX_KEY,
  THEME_KEY,
  isThemeMode,
  saveInboxMonitor,
  saveLastProject,
  saveTheme,
} from '@/lib/storage'
import type { SyncCategory } from './categories'

export type SyncField = {
  /** The key stored in the server namespace. */
  key: string
  /** The canonical syncable value, or null when this client has no usable value. */
  read: () => string | null
  /** Apply a server value. False means the value was invalid and was not applied. */
  apply: (value: string) => boolean
}

export type SyncFieldOverrides = {
  /** Applies the light/dark/system mode through next-themes. */
  themeMode?: (value: string) => boolean
  /** Applies the Inbox monitor through its React provider. */
  inboxMonitor?: (active: boolean) => boolean
}

export type SyncFieldGroups = Record<SyncCategory, SyncField[]>

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function themeModeField(overrides: SyncFieldOverrides): SyncField {
  return {
    key: THEME_KEY,
    read: () => {
      const value = readRaw(THEME_KEY)
      return isThemeMode(value) ? value : null
    },
    apply: (value) => {
      if (!isThemeMode(value)) return false
      if (overrides.themeMode) return overrides.themeMode(value)
      saveTheme(value)
      return true
    },
  }
}

function colorThemeField(): SyncField {
  return {
    key: COLOR_THEME_KEY,
    read: () => {
      const value = readRaw(COLOR_THEME_KEY)
      return isColorTheme(value) ? value : null
    },
    apply: (value) => {
      if (!isColorTheme(value)) return false
      saveColorTheme(value)
      return true
    },
  }
}

function defaultAgentField(): SyncField {
  return {
    key: AGENT_DEFAULT_KEY,
    read: () => {
      const raw = readRaw(AGENT_DEFAULT_KEY)
      if (!raw) return null
      try {
        if (!isRecord(JSON.parse(raw))) return null
      } catch {
        return null
      }
      return JSON.stringify(readDefaultAgent())
    },
    apply: (value) => {
      try {
        const parsed: unknown = JSON.parse(value)
        if (!isRecord(parsed)) return false
        saveDefaultAgent({
          mode: parsed.mode === 'fixed' ? 'fixed' : 'last',
          agent: typeof parsed.agent === 'string' && parsed.agent.length > 0 ? parsed.agent : null,
        })
        return true
      } catch {
        return false
      }
    },
  }
}

function lastAgentField(): SyncField {
  return {
    key: LAST_AGENT_KEY,
    read: () => {
      const raw = readRaw(LAST_AGENT_KEY)
      return raw && raw.trim() ? raw : null
    },
    apply: (value) => {
      if (!value.trim()) return false
      saveLastAgent(value)
      return true
    },
  }
}

function wordingField(): SyncField {
  return {
    key: SESSION_WORDING_KEY,
    read: () => {
      const raw = readRaw(SESSION_WORDING_KEY)
      return raw && raw.trim() ? readSessionWording().singular : null
    },
    apply: (value) => {
      if (!value.trim()) return false
      saveSessionWording(value)
      return true
    },
  }
}

function costDisplayField(): SyncField {
  return {
    key: COST_DISPLAY_KEY,
    read: () => {
      const value = readRaw(COST_DISPLAY_KEY)
      return isCostDisplaySource(value) ? value : null
    },
    apply: (value) => {
      if (!isCostDisplaySource(value)) return false
      saveCostDisplay(value)
      return true
    },
  }
}

function hiddenModelsField(): SyncField {
  return {
    key: HIDDEN_MODELS_KEY,
    read: () => JSON.stringify(readHiddenModels()),
    apply: (value) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        return false
      }
      if (!isRecord(parsed)) return false
      if (!Array.isArray(parsed.providers) || !Array.isArray(parsed.models)) return false
      saveHiddenModels(normalizeHiddenModels(parsed))
      return true
    },
  }
}

function notificationsField(): SyncField {
  return {
    key: NOTIFICATION_SETTINGS_KEY,
    read: () => {
      const raw = readRaw(NOTIFICATION_SETTINGS_KEY)
      if (!raw) return null
      try {
        if (!isRecord(JSON.parse(raw))) return null
      } catch {
        return null
      }

      const settings = readNotificationSettings()
      return JSON.stringify({
        sounds: settings.sounds,
        uiSounds: settings.uiSounds,
        volume: settings.volume,
        soundKinds: settings.soundKinds,
        deskIdleMs: settings.deskIdleMs,
      })
    },
    apply: (value) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        return false
      }
      if (!isRecord(parsed)) return false

      const current = readNotificationSettings()
      const next: NotificationSettings = {
        ...current,
        soundKinds: { ...current.soundKinds },
      }
      let applied = false

      if (typeof parsed.sounds === 'boolean') {
        next.sounds = parsed.sounds
        applied = true
      }
      if (typeof parsed.uiSounds === 'boolean') {
        next.uiSounds = parsed.uiSounds
        applied = true
      }
      if (typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)) {
        next.volume = parsed.volume
        applied = true
      }
      if (typeof parsed.deskIdleMs === 'number' && Number.isFinite(parsed.deskIdleMs)) {
        next.deskIdleMs = parsed.deskIdleMs
        applied = true
      }
      if (isRecord(parsed.soundKinds)) {
        for (const kind of ATTENTION_KINDS) {
          const enabled = parsed.soundKinds[kind]
          if (typeof enabled === 'boolean') {
            next.soundKinds[kind] = enabled
            applied = true
          }
        }
      }

      if (!applied) return false
      saveNotificationSettings(next)
      return true
    },
  }
}

function lastProjectField(): SyncField {
  return {
    key: LAST_PROJECT_KEY,
    read: () => {
      const raw = readRaw(LAST_PROJECT_KEY)
      return raw && raw.trim() ? raw : null
    },
    apply: (value) => {
      if (!value.trim()) return false
      saveLastProject(value)
      return true
    },
  }
}

function showEmptyProjectsField(): SyncField {
  return {
    key: SHOW_EMPTY_PROJECTS_KEY,
    read: () => {
      const raw = readRaw(SHOW_EMPTY_PROJECTS_KEY)
      return raw === 'shown' || raw === 'hidden' ? raw : null
    },
    apply: (value) => {
      if (value !== 'shown' && value !== 'hidden') return false
      saveShowEmptyProjects(value === 'shown')
      return true
    },
  }
}

function showArchivedProjectsField(): SyncField {
  return {
    key: SHOW_ARCHIVED_PROJECTS_KEY,
    read: () => {
      const raw = readRaw(SHOW_ARCHIVED_PROJECTS_KEY)
      return raw === 'shown' || raw === 'hidden' ? raw : null
    },
    apply: (value) => {
      if (value !== 'shown' && value !== 'hidden') return false
      saveShowArchivedProjects(value === 'shown')
      return true
    },
  }
}

function inboxMonitorField(overrides: SyncFieldOverrides): SyncField {
  return {
    key: MONITOR_INBOX_KEY,
    read: () => {
      const raw = readRaw(MONITOR_INBOX_KEY)
      return raw === 'on' || raw === 'off' ? raw : null
    },
    apply: (value) => {
      if (value !== 'on' && value !== 'off') return false
      const active = value === 'on'
      if (overrides.inboxMonitor) return overrides.inboxMonitor(active)
      saveInboxMonitor(active)
      return true
    },
  }
}

export function buildSyncFields(overrides: SyncFieldOverrides = {}): SyncFieldGroups {
  return {
    theme: [themeModeField(overrides), colorThemeField()],
    preferences: [defaultAgentField(), lastAgentField(), wordingField(), costDisplayField()],
    models: [hiddenModelsField()],
    notifications: [notificationsField()],
    project: [lastProjectField(), showEmptyProjectsField(), showArchivedProjectsField()],
    inbox: [inboxMonitorField(overrides)],
  }
}
