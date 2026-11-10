import {
  MAX_SYNC_INTERVAL_MS,
  MIN_SYNC_INTERVAL_MS,
  isSyncIntervalMs,
  type ShellPolicy,
} from '@clara/shared-types'
import type Database from 'better-sqlite3'
import { readStoredShellPolicy } from '../shell-policy.ts'
import type { ClaraDatabase } from './database.ts'

export const FEATURE_SETTINGS = {
  opencode: 'features.opencode',
  local: 'features.local',
  relay: 'features.relay',
  push: 'features.push',
} as const

export const AGENT_STOPPED_SETTING = 'agent.stopped'
export const SHELL_MODE_SETTING = 'shell.mode'
export const SHELL_COMMANDS_SETTING = 'shell.commands'
export const MONITORING_SETTING = 'monitoring.enabled'
export const SYNC_ENABLED_SETTING = 'sync.enabled'
export const SYNC_INTERVAL_SETTING = 'sync.intervalMs'
export const ORCHESTRATION_SETTING = 'orchestration.enabled'

export type FeatureName = keyof typeof FEATURE_SETTINGS

export type SettingKey =
  | (typeof FEATURE_SETTINGS)[FeatureName]
  | typeof AGENT_STOPPED_SETTING
  | typeof SHELL_MODE_SETTING
  | typeof SHELL_COMMANDS_SETTING
  | typeof MONITORING_SETTING
  | typeof SYNC_ENABLED_SETTING
  | typeof SYNC_INTERVAL_SETTING
  | typeof ORCHESTRATION_SETTING

export type FeatureSettings = Record<FeatureName, boolean>

export type SyncSettings = {
  enabled: boolean
  intervalMs: number
}

export type AgentSettings = {
  features: FeatureSettings
  stopped: boolean
  shell: ShellPolicy
  /** The panel traffic meter records nothing while this is false. */
  monitoring: boolean
  sync: SyncSettings
  /** Keeps a local Clara orchestration service running. */
  orchestration: boolean
}

export const FEATURE_NAMES = Object.keys(FEATURE_SETTINGS) as FeatureName[]

const SETTING_KEYS = new Set<string>([
  ...Object.values(FEATURE_SETTINGS),
  AGENT_STOPPED_SETTING,
  SHELL_MODE_SETTING,
  SHELL_COMMANDS_SETTING,
  MONITORING_SETTING,
  SYNC_ENABLED_SETTING,
  SYNC_INTERVAL_SETTING,
  ORCHESTRATION_SETTING,
])

/**
 * Booleans, one mode string, one command array, and one interval are the only
 * values in this table. Harness credentials live in the separate encrypted
 * harness tables; device keys, relay tokens, and push endpoints keep their existing
 * file or environment storage.
 */
export class SettingsStore {
  private readonly db: ClaraDatabase
  private readonly selectStatement: Database.Statement
  private readonly upsertStatement: Database.Statement

  constructor(db: ClaraDatabase) {
    this.db = db
    this.selectStatement = db.prepare('SELECT value FROM settings WHERE key = ?')
    this.upsertStatement = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
  }

  get(): AgentSettings {
    const features = {} as FeatureSettings
    for (const feature of FEATURE_NAMES) {
      features[feature] = this.readBoolean(FEATURE_SETTINGS[feature])
    }
    return {
      features,
      stopped: this.readBoolean(AGENT_STOPPED_SETTING),
      shell: this.getShellPolicy(),
      monitoring: this.readBoolean(MONITORING_SETTING),
      sync: this.getSync(),
      orchestration: this.readBoolean(ORCHESTRATION_SETTING),
    }
  }

  getFeature(feature: FeatureName): boolean {
    return this.readBoolean(FEATURE_SETTINGS[feature])
  }

  getStopped(): boolean {
    return this.readBoolean(AGENT_STOPPED_SETTING)
  }

  getShellPolicy(): ShellPolicy {
    return readStoredShellPolicy(
      this.readValue(SHELL_MODE_SETTING),
      this.readValue(SHELL_COMMANDS_SETTING)
    )
  }

  getMonitoring(): boolean {
    return this.readBoolean(MONITORING_SETTING)
  }

  getOrchestration(): boolean {
    return this.readBoolean(ORCHESTRATION_SETTING)
  }

  getSync(): SyncSettings {
    return {
      enabled: this.readBoolean(SYNC_ENABLED_SETTING),
      intervalMs: this.readSyncInterval(),
    }
  }

  getSyncEnabled(): boolean {
    return this.readBoolean(SYNC_ENABLED_SETTING)
  }

  getSyncInterval(): number {
    return this.readSyncInterval()
  }

  setFeature(feature: FeatureName, enabled: boolean): AgentSettings {
    this.assertFeature(feature)
    assertBoolean(enabled, FEATURE_SETTINGS[feature])
    this.writeValue(FEATURE_SETTINGS[feature], enabled)
    return this.get()
  }

  setStopped(stopped: boolean): AgentSettings {
    assertBoolean(stopped, AGENT_STOPPED_SETTING)
    this.writeValue(AGENT_STOPPED_SETTING, stopped)
    return this.get()
  }

  setShellPolicy(policy: ShellPolicy): AgentSettings {
    this.writeValue(SHELL_MODE_SETTING, policy.mode)
    this.writeValue(SHELL_COMMANDS_SETTING, policy.commands)
    return this.get()
  }

  setMonitoring(enabled: boolean): AgentSettings {
    assertBoolean(enabled, MONITORING_SETTING)
    this.writeValue(MONITORING_SETTING, enabled)
    return this.get()
  }

  setOrchestration(enabled: boolean): AgentSettings {
    assertBoolean(enabled, ORCHESTRATION_SETTING)
    this.writeValue(ORCHESTRATION_SETTING, enabled)
    return this.get()
  }

  setSync(settings: SyncSettings): AgentSettings {
    assertBoolean(settings.enabled, SYNC_ENABLED_SETTING)
    assertSyncInterval(settings.intervalMs)
    this.writeValue(SYNC_ENABLED_SETTING, settings.enabled)
    this.writeValue(SYNC_INTERVAL_SETTING, settings.intervalMs)
    return this.get()
  }

  private readSyncInterval(): number {
    const parsed = this.readValue(SYNC_INTERVAL_SETTING)
    if (typeof parsed !== 'number' || !isSyncIntervalMs(parsed)) {
      throw new Error(
        `The Clara setting "${SYNC_INTERVAL_SETTING}" in ${this.db.name} must be an integer between ${MIN_SYNC_INTERVAL_MS} and ${MAX_SYNC_INTERVAL_MS} milliseconds`
      )
    }
    return parsed
  }

  private readBoolean(key: SettingKey): boolean {
    const parsed = this.readValue(key)
    if (typeof parsed !== 'boolean') {
      throw new Error(`The Clara setting "${key}" in ${this.db.name} must be a boolean`)
    }
    return parsed
  }

  private readValue(key: SettingKey): unknown {
    const row = this.selectStatement.get(key) as { value?: unknown } | undefined
    if (!row) {
      throw new Error(`The Clara setting "${key}" is missing from ${this.db.name}`)
    }
    if (typeof row.value !== 'string') {
      throw new Error(`The Clara setting "${key}" in ${this.db.name} is not a JSON value`)
    }

    try {
      return JSON.parse(row.value)
    } catch (cause) {
      throw new Error(`The Clara setting "${key}" in ${this.db.name} is not valid JSON`, {
        cause,
      })
    }
  }

  private writeValue(key: SettingKey, value: unknown): void {
    if (!SETTING_KEYS.has(key)) throw new Error(`Unknown Clara setting "${key}"`)
    this.upsertStatement.run(key, JSON.stringify(value), Date.now())
  }

  private assertFeature(feature: string): asserts feature is FeatureName {
    if (!(feature in FEATURE_SETTINGS)) {
      throw new Error(`Unknown Clara feature "${feature}"`)
    }
  }
}

export function isFeatureName(value: unknown): value is FeatureName {
  return typeof value === 'string' && value in FEATURE_SETTINGS
}

function assertBoolean(value: unknown, key: SettingKey): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`The Clara setting "${key}" must be a boolean`)
  }
}

function assertSyncInterval(value: number): void {
  if (!isSyncIntervalMs(value)) {
    throw new Error(
      `The Clara setting "${SYNC_INTERVAL_SETTING}" must be an integer between ${MIN_SYNC_INTERVAL_MS} and ${MAX_SYNC_INTERVAL_MS} milliseconds`
    )
  }
}
