import type {
  PanelControls,
  PanelFeatureName,
  PanelSyncUpdate,
  ShellPolicy,
} from '@clara/shared-types'

/**
 * The mutation surface of the panel API. The read snapshot stays on
 * `PanelDataSource`; keeping writes behind this small interface prevents the
 * panel from reaching into controllers or the database directly.
 */
export type PanelControlService = {
  controls: () => PanelControls
  setFeature: (feature: PanelFeatureName, enabled: boolean) => Promise<PanelControls>
  setStopped: (stopped: boolean) => Promise<PanelControls>
  setShellPolicy: (policy: ShellPolicy) => Promise<PanelControls>
  setMonitoring: (enabled: boolean) => Promise<PanelControls>
  setSync: (update: PanelSyncUpdate) => Promise<PanelControls>
  setOrchestration: (enabled: boolean) => Promise<PanelControls>
}

export type PanelControlFailure = {
  status: number
  code: string
  message: string
}

/** A control error the panel can return without turning it into a 500. */
export class PanelControlError extends Error implements PanelControlFailure {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PanelControlError'
    this.status = status
    this.code = code
  }
}

export function readControlFailure(cause: unknown): PanelControlFailure | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const record = cause as { status?: unknown; code?: unknown; message?: unknown }
  if (
    typeof record.status !== 'number' ||
    !Number.isInteger(record.status) ||
    record.status < 400 ||
    record.status > 599 ||
    typeof record.code !== 'string' ||
    typeof record.message !== 'string'
  ) {
    return undefined
  }
  return { status: record.status, code: record.code, message: record.message }
}
