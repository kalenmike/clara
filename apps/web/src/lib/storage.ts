import { notifySettingChanged } from '@/lib/setting-events'

export const LAST_PROJECT_KEY = 'clara.lastProject'

export function readLastProject(): string | null {
  return window.localStorage.getItem(LAST_PROJECT_KEY)
}

export function saveLastProject(projectID: string): void {
  window.localStorage.setItem(LAST_PROJECT_KEY, projectID)
  notifySettingChanged(LAST_PROJECT_KEY)
}

const LAST_WORKSPACE_PREFIX = 'clara:last-workspace:'

/** The workspace most recently used to start work on a project. */
export function readLastWorkspace(projectID: string): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(`${LAST_WORKSPACE_PREFIX}${projectID}`)
}

export function saveLastWorkspace(projectID: string, workspaceID: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`${LAST_WORKSPACE_PREFIX}${projectID}`, workspaceID)
}

export function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem('clara.sidebar') === 'collapsed'
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem('clara.sidebar', collapsed ? 'collapsed' : 'expanded')
}

export const SIDEBAR_WIDTH_MIN = 208
export const SIDEBAR_WIDTH_DEFAULT = 288
export const SIDEBAR_WIDTH_MAX = 480

const SIDEBAR_WIDTH_KEY = 'clara.sidebarWidth'

export function readSidebarWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
  if (!raw) return SIDEBAR_WIDTH_DEFAULT
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value))
}

export function saveSidebarWidth(width: number): void {
  const clamped = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)))
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
}

export const SIDE_PANEL_WIDTH_MIN = 240
export const SIDE_PANEL_WIDTH_DEFAULT = 320
export const SIDE_PANEL_WIDTH_MAX = 640

const SIDE_PANEL_WIDTH_KEY = 'clara.sidePanelWidth'

export function readSidePanelWidth(): number {
  const raw = window.localStorage.getItem(SIDE_PANEL_WIDTH_KEY)
  if (!raw) return SIDE_PANEL_WIDTH_DEFAULT
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_DEFAULT
  return Math.min(SIDE_PANEL_WIDTH_MAX, Math.max(SIDE_PANEL_WIDTH_MIN, value))
}

export function saveSidePanelWidth(width: number): void {
  const clamped = Math.min(SIDE_PANEL_WIDTH_MAX, Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(width)))
  window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(clamped))
}

export type SidebarSection = 'inbox' | 'outbox' | 'drafts' | 'snoozed' | 'archived'

const SIDEBAR_SECTIONS_KEY = 'clara.sidebarSections'
const SIDEBAR_SECTIONS_DEFAULT: Record<SidebarSection, boolean> = {
  inbox: true,
  outbox: true,
  drafts: true,
  snoozed: false,
  archived: false,
}

export function readSidebarSections(): Record<SidebarSection, boolean> {
  const raw = window.localStorage.getItem(SIDEBAR_SECTIONS_KEY)
  if (!raw) return { ...SIDEBAR_SECTIONS_DEFAULT }
  try {
    const value = JSON.parse(raw) as Partial<Record<SidebarSection, boolean>>
    return {
      inbox: typeof value.inbox === 'boolean' ? value.inbox : SIDEBAR_SECTIONS_DEFAULT.inbox,
      outbox: typeof value.outbox === 'boolean' ? value.outbox : SIDEBAR_SECTIONS_DEFAULT.outbox,
      drafts: typeof value.drafts === 'boolean' ? value.drafts : SIDEBAR_SECTIONS_DEFAULT.drafts,
      snoozed:
        typeof value.snoozed === 'boolean' ? value.snoozed : SIDEBAR_SECTIONS_DEFAULT.snoozed,
      archived:
        typeof value.archived === 'boolean' ? value.archived : SIDEBAR_SECTIONS_DEFAULT.archived,
    }
  } catch {
    return { ...SIDEBAR_SECTIONS_DEFAULT }
  }
}

export function saveSidebarSections(sections: Record<SidebarSection, boolean>): void {
  window.localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sections))
}

const COMPOSER_TABS_KEY = 'clara.composerTabs'

/** Stored as JSON; `composer-tabs` owns the validation. */
export function readComposerTabsRaw(): string | null {
  return window.localStorage.getItem(COMPOSER_TABS_KEY)
}

export function saveComposerTabsRaw(value: string): void {
  window.localStorage.setItem(COMPOSER_TABS_KEY, value)
}

export const COMPOSER_HEIGHT_MIN = 220
export const COMPOSER_HEIGHT_DEFAULT = 320
export const COMPOSER_HEIGHT_MAX = 720

/** Room the dock must leave for the chat header, thread, and usage bar. */
const COMPOSER_HEIGHT_RESERVED = 200

const COMPOSER_HEIGHT_KEY = 'clara.composerHeight'

/** The tallest the dock may grow without covering the whole thread. */
export function composerHeightMax(viewportHeight: number): number {
  return Math.max(
    COMPOSER_HEIGHT_MIN,
    Math.min(COMPOSER_HEIGHT_MAX, Math.round(viewportHeight - COMPOSER_HEIGHT_RESERVED))
  )
}

export function clampComposerHeight(height: number, viewportHeight: number): number {
  return Math.min(
    composerHeightMax(viewportHeight),
    Math.max(COMPOSER_HEIGHT_MIN, Math.round(height))
  )
}

export function readComposerHeight(): number {
  const raw = window.localStorage.getItem(COMPOSER_HEIGHT_KEY)
  if (!raw) return clampComposerHeight(COMPOSER_HEIGHT_DEFAULT, window.innerHeight)
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value))
    return clampComposerHeight(COMPOSER_HEIGHT_DEFAULT, window.innerHeight)
  return clampComposerHeight(value, window.innerHeight)
}

export function saveComposerHeight(height: number): void {
  window.localStorage.setItem(
    COMPOSER_HEIGHT_KEY,
    String(clampComposerHeight(height, window.innerHeight))
  )
}

export const THEME_KEY = 'clara.theme'
export const THEME_VALUES = ['light', 'dark', 'system'] as const

export type ThemeMode = (typeof THEME_VALUES)[number]

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_VALUES as readonly string[]).includes(value)
}

export function readTheme(): ThemeMode {
  const value = window.localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function saveTheme(theme: ThemeMode): void {
  window.localStorage.setItem(THEME_KEY, theme)
}

export type SidePanelTab = 'info' | 'git' | 'terminal'

export function readSidePanelTab(): SidePanelTab {
  const value = window.localStorage.getItem('clara.sidePanelTab')
  return value === 'git' || value === 'terminal' ? value : 'info'
}

export function saveSidePanelTab(tab: SidePanelTab): void {
  window.localStorage.setItem('clara.sidePanelTab', tab)
}

export function readShowInternal(): boolean {
  return window.localStorage.getItem('clara.internalMessages') === 'shown'
}

export function saveShowInternal(show: boolean): void {
  window.localStorage.setItem('clara.internalMessages', show ? 'shown' : 'hidden')
}

export const MONITOR_INBOX_KEY = 'clara.monitorInbox'

export function readInboxMonitor(): boolean {
  return window.localStorage.getItem(MONITOR_INBOX_KEY) === 'on'
}

export function saveInboxMonitor(active: boolean): void {
  window.localStorage.setItem(MONITOR_INBOX_KEY, active ? 'on' : 'off')
  notifySettingChanged(MONITOR_INBOX_KEY)
}

export function readDraft(sessionID: string): string {
  return window.localStorage.getItem(`clara.draft.${sessionID}`) ?? ''
}

export function saveDraft(sessionID: string, text: string): void {
  if (text.trim().length === 0) {
    window.localStorage.removeItem(`clara.draft.${sessionID}`)
    return
  }
  window.localStorage.setItem(`clara.draft.${sessionID}`, text)
}
