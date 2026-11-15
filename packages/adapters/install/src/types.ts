import type {
  AdapterInstallJob,
  AdapterInstallJobState,
  AdapterInstallMethod,
  PanelInstallManifest,
} from '@clara/shared-types'

export type { AdapterInstallJob, AdapterInstallJobState, AdapterInstallMethod }

export type CommandResult = {
  stdout: string
  stderr: string
}

export type RunCommand = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<CommandResult>

export type InstallRunResult = {
  exitCode: number | null
  signal?: NodeJS.Signals | null
}

export type InstallRunner = (
  command: string,
  args: string[],
  onLine: (line: string) => void,
  signal: AbortSignal
) => Promise<InstallRunResult>

export type InstallPlanInput = {
  kind: string
  method: AdapterInstallMethod
  manifest: PanelInstallManifest
  pairingCode: string
  opencodeUrl?: string
  host?: {
    alias?: string
    hostname?: string
    user?: string
    port?: number
  }
  container?: string
}

export type InstallPlan = {
  command: string
  args: string[]
  target: string
  script: string
}
