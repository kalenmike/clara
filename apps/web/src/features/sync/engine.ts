import type { SyncSnapshot } from '@clara/shared-types'
import type { SyncRequestAction, SyncResponse } from '@/lib/transport/relay'
import { SYNC_CATEGORIES, type SyncCategory } from './categories'
import type { SyncField, SyncFieldGroups, SyncStandaloneFields } from './fields'
import type { SyncPreferences } from './preferences'
import { SYNC_STANDALONE, type SyncStandalone } from './standalone'

const PUSH_DEBOUNCE_MS = 500

export type SettingsSyncStatus = {
  syncing: boolean
  lastSyncedAt: number | null
  error: string | null
}

export type SettingsSyncEngineOptions = {
  request: (action: SyncRequestAction) => Promise<SyncResponse>
  fields: SyncFieldGroups
  standaloneFields: SyncStandaloneFields
  readPreferences: () => SyncPreferences
  writePreferences: (preferences: SyncPreferences) => void
  onStatus: (status: SettingsSyncStatus) => void
  intervalMs: number
  pushDebounceMs?: number
  now?: () => number
}

type FieldScope =
  { kind: 'category'; category: SyncCategory } | { kind: 'standalone'; standalone: SyncStandalone }

type FieldEntry = {
  field: SyncField
  scope: FieldScope
}

/**
 * Pulls only when the namespace revision changes, pushes debounced local edits,
 * and remembers the last revision plus unsynced keys on this client. Server
 * values always win for a key the server already has.
 */
export class SettingsSyncEngine {
  private readonly options: SettingsSyncEngineOptions
  private readonly fieldByKey = new Map<string, FieldEntry>()
  private readonly fieldByCategory = new Map<SyncCategory, SyncField[]>()
  private readonly fieldByStandalone = new Map<SyncStandalone, SyncField[]>()

  private status: SettingsSyncStatus = {
    syncing: false,
    lastSyncedAt: null,
    error: null,
  }

  private running = false
  private halted = false
  private applying = false
  private active = 0
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private intervalMs: number

  constructor(options: SettingsSyncEngineOptions) {
    this.options = options
    this.intervalMs = normalizeInterval(options.intervalMs)

    for (const category of SYNC_CATEGORIES) {
      const fields = options.fields[category]
      this.fieldByCategory.set(category, fields)
      for (const field of fields) {
        this.fieldByKey.set(field.key, {
          field,
          scope: { kind: 'category', category },
        })
      }
    }

    for (const standalone of SYNC_STANDALONE) {
      const field = options.standaloneFields[standalone]
      this.fieldByStandalone.set(standalone, [field])
      this.fieldByKey.set(field.key, {
        field,
        scope: { kind: 'standalone', standalone },
      })
    }
  }

  /** Start or resume. `forcePull` is used when an admin re-enables sync. */
  start(forcePull = false): Promise<void> {
    this.running = true
    this.halted = false
    this.generation += 1
    this.scheduleCheck()
    return (forcePull ? this.refresh() : this.syncNow()).catch(() => undefined)
  }

  stop(): void {
    this.running = false
    this.generation += 1
    this.clearCheckTimer()
    this.clearPushTimer()
    this.emitStatus()
  }

  setIntervalMs(value: number): void {
    const next = normalizeInterval(value)
    if (next === this.intervalMs) return
    this.intervalMs = next
    if (this.running) this.scheduleCheck()
  }

  /** Turn one category on. A failed pull leaves it off. */
  enable(category: SyncCategory): Promise<void> {
    return this.enableScope({ kind: 'category', category })
  }

  /** Turn one isolated single-setting share on. A failed pull leaves it off. */
  enableStandalone(standalone: SyncStandalone): Promise<void> {
    return this.enableScope({ kind: 'standalone', standalone })
  }

  /** Stop applying and pushing one category. Server entries are left intact. */
  disable(category: SyncCategory): void {
    this.disableScope({ kind: 'category', category })
  }

  /** Stop applying and pushing one isolated setting. */
  disableStandalone(standalone: SyncStandalone): void {
    this.disableScope({ kind: 'standalone', standalone })
  }

  /** Called by the setting-change bus, including while offline. */
  notifyLocalChange(key: string): void {
    if (this.applying || this.halted) return
    const entry = this.fieldByKey.get(key)
    if (!entry) return
    const preferences = this.options.readPreferences()
    if (!this.isScopeEnabled(entry.scope, preferences)) return

    this.addDirty([key])
    if (this.running) this.schedulePush()
  }

  /** Flush queued local edits, then check for a new server revision. */
  syncNow(): Promise<void> {
    if (!this.running || this.halted) return Promise.resolve()
    const generation = this.generation

    return this.serialized(() =>
      this.track(async () => {
        try {
          if (!this.running || !this.isCurrent(generation)) return
          if (!this.hasEnabledScopes()) return

          const preferences = this.options.readPreferences()
          if (preferences.revision === null) {
            await this.pullAndApply(generation)
            return
          }

          const flushed = await this.flushDirtyInternal(generation)
          if (!this.isCurrent(generation) || !flushed) return
          await this.checkAndPull(generation)
        } catch (cause) {
          this.setError(describeError(cause))
        }
      })
    )
  }

  /** Force a full pull, used when an admin re-enables sync. */
  refresh(): Promise<void> {
    if (!this.running || this.halted) return Promise.resolve()
    if (!this.hasEnabledScopes()) return Promise.resolve()
    const generation = this.generation

    return this.serialized(() =>
      this.track(async () => {
        try {
          if (!this.running || !this.isCurrent(generation)) return
          await this.pullAndApply(generation)
        } catch (cause) {
          this.setError(describeError(cause))
        }
      })
    )
  }

  /** Public for the debounce and for tests. */
  flushDirty(): Promise<void> {
    if (!this.running || this.halted) return Promise.resolve()
    const generation = this.generation

    return this.serialized(() =>
      this.track(async () => {
        try {
          if (!this.running || !this.isCurrent(generation)) return
          await this.flushDirtyInternal(generation)
        } catch (cause) {
          this.setError(describeError(cause))
        }
      })
    )
  }

  private async checkAndPull(generation: number): Promise<void> {
    const response = await this.options.request({
      type: 'sync.check',
      id: requestId(),
    })
    if (!this.isCurrent(generation)) return

    if (response.type === 'error') {
      this.handleError(response)
      return
    }
    if (response.type !== 'revision') return

    const preferences = this.options.readPreferences()
    if (preferences.revision !== null && preferences.revision === response.revision) {
      this.markSynced()
      return
    }

    await this.pullAndApply(generation)
  }

  private async pullAndApply(generation: number): Promise<boolean> {
    const response = await this.options.request({
      type: 'sync.pull',
      id: requestId(),
    })
    if (!this.isCurrent(generation)) return false

    if (response.type === 'error') {
      this.handleError(response)
      return false
    }
    if (response.type !== 'snapshot') return false

    await this.applyServerSnapshot(response.snapshot, generation)
    return this.isCurrent(generation)
  }

  private async applyServerSnapshot(snapshot: SyncSnapshot, generation: number): Promise<void> {
    const failed = this.applySnapshot(snapshot)
    if (!this.isCurrent(generation)) return

    this.setRevision(snapshot.revision)
    this.removeDirty(this.enabledDirtyKeys())
    this.markSynced()

    await this.pushLocalOnly(snapshot, generation, failed)
  }

  private applySnapshot(snapshot: SyncSnapshot): Set<string> {
    const live = new Map<string, string>()
    for (const entry of snapshot.entries) {
      if (entry.value !== null) live.set(entry.key, entry.value)
    }

    const failed = new Set<string>()
    this.applying = true
    try {
      for (const field of this.enabledFields()) {
        const value = live.get(field.key)
        if (value === undefined) continue
        try {
          if (!field.apply(value)) failed.add(field.key)
        } catch {
          failed.add(field.key)
        }
      }
    } finally {
      this.applying = false
    }
    return failed
  }

  /**
   * A key the server lacks is filled from this client. A key whose server value
   * was unusable is also replaced so the namespace can heal.
   */
  private async pushLocalOnly(
    snapshot: SyncSnapshot,
    generation: number,
    failed: Set<string>
  ): Promise<void> {
    const live = new Set(
      snapshot.entries.filter((entry) => entry.value !== null).map((entry) => entry.key)
    )
    const entries: Array<{ key: string; value: string }> = []

    for (const field of this.enabledFields()) {
      if (live.has(field.key) && !failed.has(field.key)) continue
      const value = field.read()
      if (value !== null) entries.push({ key: field.key, value })
    }

    if (entries.length === 0) return

    const pushedKeys = entries.map((entry) => entry.key)
    this.addDirty(pushedKeys)

    const response = await this.options.request({
      type: 'sync.push',
      id: requestId(),
      baseRevision: snapshot.revision,
      entries,
    })
    if (!this.isCurrent(generation)) return

    if (response.type === 'snapshot') {
      this.setRevision(response.snapshot.revision)
      this.removeDirty(pushedKeys)
      this.markSynced()
      return
    }

    if (response.type === 'error') {
      if (response.code === 'conflict' && response.snapshot) {
        // Another device wrote first. Apply it, but do not retry this batch.
        this.applySnapshot(response.snapshot)
        this.removeDirty(this.enabledDirtyKeys())
        this.setRevision(response.snapshot.revision)
        this.markSynced()
        return
      }
      if (response.code === 'invalid' || response.code === 'too_large') {
        this.removeDirty(pushedKeys)
      }
      this.handleError(response)
    }
  }

  private async flushDirtyInternal(generation: number): Promise<boolean> {
    const preferences = this.options.readPreferences()
    if (preferences.revision === null && preferences.dirty.length > 0) {
      // Without a known revision a local push could overwrite another device.
      // Pull first and let an existing server value win.
      return this.pullAndApply(generation)
    }

    const entries: Array<{ key: string; value: string }> = []
    const pushedKeys: string[] = []
    const dropped: string[] = []

    for (const key of preferences.dirty) {
      const entry = this.fieldByKey.get(key)
      if (!entry || !this.isScopeEnabled(entry.scope, preferences)) {
        dropped.push(key)
        continue
      }

      const value = entry.field.read()
      if (value === null) {
        dropped.push(key)
        continue
      }

      entries.push({ key, value })
      pushedKeys.push(key)
    }

    if (dropped.length > 0) this.removeDirty(dropped)
    if (entries.length === 0) return true

    const response = await this.options.request({
      type: 'sync.push',
      id: requestId(),
      ...(preferences.revision === null ? {} : { baseRevision: preferences.revision }),
      entries,
    })
    if (!this.isCurrent(generation)) return false

    if (response.type === 'snapshot') {
      this.removeDirty(pushedKeys)
      this.setRevision(response.snapshot.revision)
      this.markSynced()
      return true
    }

    if (response.type === 'error') {
      if (response.code === 'conflict') {
        // Server wins. The local batch is discarded.
        this.removeDirty(pushedKeys)
        if (response.snapshot) {
          await this.applyServerSnapshot(response.snapshot, generation)
        } else {
          await this.pullAndApply(generation)
        }
        return true
      }
      if (response.code === 'invalid' || response.code === 'too_large') {
        this.removeDirty(pushedKeys)
      }
      this.handleError(response)
    }
    return false
  }

  private scheduleCheck(): void {
    this.clearCheckTimer()
    if (!this.running || this.halted) return
    if (!this.hasEnabledScopes()) return

    this.checkTimer = setTimeout(() => {
      this.checkTimer = null
      void this.syncNow()
        .catch(() => undefined)
        .finally(() => this.scheduleCheck())
    }, this.intervalMs)
  }

  private schedulePush(): void {
    if (this.pushTimer !== null) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.flushDirty().catch(() => undefined)
    }, this.options.pushDebounceMs ?? PUSH_DEBOUNCE_MS)
  }

  private clearCheckTimer(): void {
    if (this.checkTimer !== null) clearTimeout(this.checkTimer)
    this.checkTimer = null
  }

  private clearPushTimer(): void {
    if (this.pushTimer !== null) clearTimeout(this.pushTimer)
    this.pushTimer = null
  }

  private enableScope(scope: FieldScope): Promise<void> {
    const generation = this.generation
    return this.serialized(() =>
      this.track(async () => {
        if (!this.isCurrent(generation)) return
        const preferences = this.options.readPreferences()
        if (this.isScopeEnabled(scope, preferences)) return

        this.setScope(scope, true)
        this.setError(null)
        try {
          const ok = await this.pullAndApply(generation)
          if (!this.isCurrent(generation)) return
          if (!ok) {
            this.setScope(scope, false)
            return
          }
          this.scheduleCheck()
        } catch (cause) {
          if (!this.isCurrent(generation)) return
          this.setScope(scope, false)
          this.setError(describeError(cause))
        }
      })
    )
  }

  private disableScope(scope: FieldScope): void {
    const preferences = this.options.readPreferences()
    if (!this.isScopeEnabled(scope, preferences)) return
    this.setScope(scope, false)
    if (!this.hasEnabledScopes()) this.clearCheckTimer()
  }

  private enabledScopes(): FieldScope[] {
    const preferences = this.options.readPreferences()
    const scopes: FieldScope[] = []
    for (const category of SYNC_CATEGORIES) {
      if (preferences.categories[category]) scopes.push({ kind: 'category', category })
    }
    for (const standalone of SYNC_STANDALONE) {
      if (preferences.standalone[standalone]) scopes.push({ kind: 'standalone', standalone })
    }
    return scopes
  }

  private enabledFields(): SyncField[] {
    const fields: SyncField[] = []
    for (const scope of this.enabledScopes()) {
      if (scope.kind === 'category') {
        fields.push(...(this.fieldByCategory.get(scope.category) ?? []))
      } else {
        fields.push(...(this.fieldByStandalone.get(scope.standalone) ?? []))
      }
    }
    return fields
  }

  private hasEnabledScopes(): boolean {
    return this.enabledScopes().length > 0
  }

  private isScopeEnabled(scope: FieldScope, preferences: SyncPreferences): boolean {
    return scope.kind === 'category'
      ? preferences.categories[scope.category]
      : preferences.standalone[scope.standalone]
  }

  private enabledDirtyKeys(): string[] {
    const preferences = this.options.readPreferences()
    return preferences.dirty.filter((key) => {
      const entry = this.fieldByKey.get(key)
      return Boolean(entry && this.isScopeEnabled(entry.scope, preferences))
    })
  }

  private setScope(scope: FieldScope, enabled: boolean): void {
    const preferences = this.options.readPreferences()
    const categories =
      scope.kind === 'category'
        ? { ...preferences.categories, [scope.category]: enabled }
        : preferences.categories
    const standalone =
      scope.kind === 'standalone'
        ? { ...preferences.standalone, [scope.standalone]: enabled }
        : preferences.standalone
    const dirty = preferences.dirty.filter((key) => {
      const entry = this.fieldByKey.get(key)
      return !entry || this.isScopeEnabled(entry.scope, { ...preferences, categories, standalone })
    })
    this.options.writePreferences({ ...preferences, categories, standalone, dirty })
  }

  private setRevision(revision: number): void {
    const preferences = this.options.readPreferences()
    if (preferences.revision === revision) return
    this.options.writePreferences({ ...preferences, revision })
  }

  private addDirty(keys: string[]): void {
    if (keys.length === 0) return
    const preferences = this.options.readPreferences()
    const dirty = new Set(preferences.dirty)
    for (const key of keys) dirty.add(key)
    if (dirty.size === preferences.dirty.length) return
    this.options.writePreferences({ ...preferences, dirty: [...dirty] })
  }

  private removeDirty(keys: string[]): void {
    if (keys.length === 0) return
    const preferences = this.options.readPreferences()
    const remove = new Set(keys)
    const dirty = preferences.dirty.filter((key) => !remove.has(key))
    if (dirty.length === preferences.dirty.length) return
    this.options.writePreferences({ ...preferences, dirty })
  }

  private handleError(response: Extract<SyncResponse, { type: 'error' }>): void {
    if (response.code === 'disabled') {
      this.halted = true
      this.clearCheckTimer()
    }
    this.setError(syncErrorMessage(response))
  }

  private markSynced(): void {
    this.status = {
      ...this.status,
      lastSyncedAt: (this.options.now ?? Date.now)(),
      error: null,
    }
    this.emitStatus()
  }

  private setError(error: string | null): void {
    if (this.status.error === error) return
    this.status = { ...this.status, error }
    this.emitStatus()
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation
  }

  private emitStatus(): void {
    this.options.onStatus({
      ...this.status,
      syncing: this.active > 0,
    })
  }

  private track<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1
    this.emitStatus()
    return task().finally(() => {
      this.active = Math.max(0, this.active - 1)
      this.emitStatus()
    })
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

function normalizeInterval(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 30_000
  return Math.max(1, Math.round(value))
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function describeError(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : 'Could not reach the home server to sync settings.'
}

function syncErrorMessage(response: Extract<SyncResponse, { type: 'error' }>): string {
  switch (response.code) {
    case 'disabled':
      return 'Settings sync is disabled by the home server.'
    case 'storage':
      return 'The home server could not read its settings store.'
    case 'conflict':
      return response.message || 'Another device changed these settings.'
    case 'too_large':
      return response.message || 'The synced settings are too large.'
    default:
      return response.message || 'The home server rejected a synced setting.'
  }
}
