export type LabTab = 'pipeline' | 'runs' | 'traffic' | 'console' | 'sessions' | 'settings'

export interface LabSettings {
  hostWorkspace: string
  target: string
  pauseAfterStep: boolean
  tab: LabTab
}

export const DEFAULT_SETTINGS: LabSettings = {
  hostWorkspace: '',
  target: '',
  pauseAfterStep: false,
  tab: 'pipeline',
}

const KEY = 'clara-lab.settings.v1'
const TABS: LabTab[] = ['pipeline', 'runs', 'traffic', 'console', 'sessions', 'settings']

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function tab(value: unknown): LabTab {
  if (value === 'run') return 'runs'
  return TABS.includes(value as LabTab) ? (value as LabTab) : 'pipeline'
}

export function loadSettings(): LabSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<LabSettings>
    return {
      hostWorkspace: string(parsed.hostWorkspace),
      target: string(parsed.target),
      pauseAfterStep: parsed.pauseAfterStep === true,
      tab: tab(parsed.tab),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: LabSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private-mode storage can fail; the lab still works for this session.
  }
}
