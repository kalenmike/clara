export type LabTab = 'pipeline' | 'run' | 'traffic'

export interface LabSettings {
  hostWorkspace: string
  runtimeWorkspace: string
  target: string
  pauseAfterStep: boolean
  tab: LabTab
}

export const DEFAULT_SETTINGS: LabSettings = {
  hostWorkspace: '',
  runtimeWorkspace: '',
  target: '',
  pauseAfterStep: false,
  tab: 'pipeline',
}

const KEY = 'clara-lab.settings.v1'

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function loadSettings(): LabSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<LabSettings>
    return {
      hostWorkspace: string(parsed.hostWorkspace),
      runtimeWorkspace: string(parsed.runtimeWorkspace),
      target: string(parsed.target),
      pauseAfterStep: parsed.pauseAfterStep === true,
      tab:
        parsed.tab === 'run' || parsed.tab === 'traffic' || parsed.tab === 'pipeline'
          ? parsed.tab
          : 'pipeline',
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
