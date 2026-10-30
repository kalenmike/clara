import type { ConnectionConfig } from '@/lib/client'

const LOCAL_KEY = 'clara.connection.local'
const SESSION_KEY = 'clara.connection.session'

type StoredConnection = ConnectionConfig

function parse(raw: string | null): StoredConnection | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredConnection>
    if (typeof value.baseUrl !== 'string' || value.baseUrl.length === 0) return null
    return {
      baseUrl: value.baseUrl,
      password: typeof value.password === 'string' ? value.password : undefined,
      label: typeof value.label === 'string' ? value.label : undefined,
      remember: Boolean(value.remember),
    }
  } catch {
    return null
  }
}

export function loadStoredConnection(): StoredConnection | null {
  return (
    parse(window.localStorage.getItem(LOCAL_KEY)) ??
    parse(window.sessionStorage.getItem(SESSION_KEY))
  )
}

export function saveStoredConnection(config: ConnectionConfig): void {
  const serialized = JSON.stringify(config)
  window.sessionStorage.removeItem(SESSION_KEY)
  window.localStorage.removeItem(LOCAL_KEY)
  if (config.remember) {
    window.localStorage.setItem(LOCAL_KEY, serialized)
  } else {
    window.sessionStorage.setItem(SESSION_KEY, serialized)
  }
}

export function clearStoredConnection(): void {
  window.sessionStorage.removeItem(SESSION_KEY)
  window.localStorage.removeItem(LOCAL_KEY)
}

export function readLastProject(): string | null {
  return window.localStorage.getItem('clara.lastProject')
}

export function saveLastProject(projectID: string): void {
  window.localStorage.setItem('clara.lastProject', projectID)
}

export function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem('clara.sidebar') === 'collapsed'
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem('clara.sidebar', collapsed ? 'collapsed' : 'expanded')
}

export function readTheme(): 'light' | 'dark' | 'system' {
  const value = window.localStorage.getItem('clara.theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function saveTheme(theme: 'light' | 'dark' | 'system'): void {
  window.localStorage.setItem('clara.theme', theme)
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
