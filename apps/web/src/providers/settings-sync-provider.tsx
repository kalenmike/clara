/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useTheme } from 'next-themes'
import { normalizeSyncIntervalMs, type AgentInfo } from '@clara/shared-types'
import { SYNC_CATEGORIES, type SyncCategory } from '@/features/sync/categories'
import { SettingsSyncEngine, type SettingsSyncStatus } from '@/features/sync/engine'
import { buildSyncFields } from '@/features/sync/fields'
import {
  readSyncPreferences,
  saveSyncPreferences,
  subscribeSyncPreferences,
} from '@/features/sync/preferences'
import { useInboxMonitor } from '@/features/sessions/inbox-monitor'
import { THEME_KEY, isThemeMode } from '@/lib/storage'
import { subscribeSettingChanged } from '@/lib/setting-events'
import { useConnection } from '@/providers/connection-provider'

const EMPTY_STATUS: SettingsSyncStatus = {
  syncing: false,
  lastSyncedAt: null,
  error: null,
}

export type SettingsSyncContextValue = {
  /** The transport can carry sync actions. */
  supported: boolean
  /** The hub admin has not disabled sync. */
  serverEnabled: boolean
  /** Both the transport and the hub are ready right now. */
  available: boolean
  reason: string | null
  intervalMs: number
  enabled: Record<SyncCategory, boolean>
  status: SettingsSyncStatus
  toggle: (category: SyncCategory) => Promise<void>
  syncNow: () => Promise<void>
}

const SettingsSyncContext = createContext<SettingsSyncContextValue | null>(null)

/**
 * Runs client settings sync for the whole connected session. The panel controls
 * both the global gate and the check cadence; this provider follows the hub's
 * broadcast and hides the feature when the admin turns it off.
 */
export function SettingsSyncProvider({ children }: { children: ReactNode }) {
  const { config, control, relayStatus } = useConnection()
  const { setTheme, theme } = useTheme()
  const { setActive } = useInboxMonitor()
  const preferences = useSyncExternalStore(
    subscribeSyncPreferences,
    readSyncPreferences,
    readSyncPreferences
  )
  const [status, setStatus] = useState<SettingsSyncStatus>(EMPTY_STATUS)
  const wasServerDisabled = useRef(false)

  const agent: AgentInfo | undefined = relayStatus?.agent ?? undefined
  const supported = Boolean(control?.requestSync)
  const serverEnabled = agent?.syncEnabled !== false
  const online = relayStatus?.state === 'open'
  const available = supported && serverEnabled && online
  const intervalMs = normalizeSyncIntervalMs(agent?.syncIntervalMs)

  // next-themes rebuilds setTheme when the selected mode changes. Keep the
  // field callback stable so a theme change does not recreate the sync engine.
  const setThemeRef = useRef(setTheme)
  setThemeRef.current = setTheme
  const appliedTheme = useRef<string | null>(null)
  const applyThemeMode = useCallback((value: string) => {
    if (!isThemeMode(value)) return false
    appliedTheme.current = value
    setThemeRef.current(value)
    return true
  }, [])

  const applyInboxMonitor = useCallback(
    (active: boolean) => {
      setActive(active)
      return true
    },
    [setActive]
  )

  const fields = useMemo(
    () => buildSyncFields({ themeMode: applyThemeMode, inboxMonitor: applyInboxMonitor }),
    [applyInboxMonitor, applyThemeMode]
  )

  // Keep one engine per transport. Interval changes reschedule its timer rather
  // than recreating it, so a panel edit does not drop an in-flight operation.
  const intervalRef = useRef(intervalMs)
  intervalRef.current = intervalMs
  const engine = useMemo(() => {
    if (!control?.requestSync) return null
    return new SettingsSyncEngine({
      request: (action) => control.requestSync(action),
      fields,
      readPreferences: readSyncPreferences,
      writePreferences: saveSyncPreferences,
      onStatus: setStatus,
      intervalMs: intervalRef.current,
    })
  }, [control, fields])

  useEffect(() => {
    if (!engine) return
    return subscribeSettingChanged((key) => engine.notifyLocalChange(key))
  }, [engine])

  useEffect(() => {
    engine?.setIntervalMs(intervalMs)
  }, [engine, intervalMs])

  // next-themes writes its own key, so the sync engine learns about mode
  // changes from the resolved React value rather than the save bus. Skip the
  // render caused by applying the server's value, or it would echo back.
  const previousTheme = useRef<string | undefined>(theme)
  useEffect(() => {
    if (previousTheme.current === theme) return
    previousTheme.current = theme
    if (theme && appliedTheme.current === theme) {
      appliedTheme.current = null
      return
    }
    appliedTheme.current = null
    engine?.notifyLocalChange(THEME_KEY)
  }, [engine, theme])

  useEffect(() => {
    if (!engine) return

    if (!serverEnabled) {
      wasServerDisabled.current = true
      engine.stop()
      return
    }

    if (!available) {
      engine.stop()
      return
    }

    const forcePull = wasServerDisabled.current
    wasServerDisabled.current = false
    engine.start(forcePull)
    return () => engine.stop()
  }, [available, engine, serverEnabled])

  const toggle = useCallback(
    async (category: SyncCategory) => {
      if (!engine) return
      const current = readSyncPreferences()
      if (current.categories[category]) engine.disable(category)
      else await engine.enable(category)
    },
    [engine]
  )

  const syncNow = useCallback(async () => {
    await engine?.syncNow()
  }, [engine])

  const reason = useMemo(() => {
    if (!supported) {
      return 'Settings sync needs the Clara hub. Pair with it or connect over its local WebSocket.'
    }
    if (!serverEnabled) return 'Settings sync is disabled by the hub admin.'
    if (!config) return 'Connect to a Clara hub to sync settings.'
    if (!online) return 'Connect to the Clara home server to sync settings.'
    return null
  }, [config, online, serverEnabled, supported])

  const enabled = useMemo(() => {
    const result = {} as Record<SyncCategory, boolean>
    for (const category of SYNC_CATEGORIES) result[category] = preferences.categories[category]
    return result
  }, [preferences])

  const value = useMemo<SettingsSyncContextValue>(
    () => ({
      supported,
      serverEnabled,
      available,
      reason,
      intervalMs,
      enabled,
      status,
      toggle,
      syncNow,
    }),
    [available, enabled, intervalMs, reason, serverEnabled, status, supported, syncNow, toggle]
  )

  return <SettingsSyncContext.Provider value={value}>{children}</SettingsSyncContext.Provider>
}

export function useSettingsSync() {
  const value = useContext(SettingsSyncContext)
  if (!value) throw new Error('useSettingsSync must be used inside SettingsSyncProvider')
  return value
}
