import { join } from 'node:path'

export type ServicePaths = {
  homeDir: string
  configDir: string
  dataDir: string
  cacheDir: string
  logDir: string
}

export type ServiceOptions = ServicePaths & {
  execPath: string
  label?: string
}

export const SYSTEMD_UNIT = 'clara.service'
export const LAUNCHD_LABEL = 'com.clara.stack'
export const WINDOWS_TASK = 'Clara'

export type ServiceKind = 'systemd' | 'launchd' | 'task-scheduler' | 'xdg-autostart' | 'none'

export type ServiceAction = { command: string; args: string[]; allowFailure?: boolean }

export type ServicePlan = {
  writes: { path: string; content: string; mode?: number }[]
  removals: string[]
  actions: ServiceAction[]
}

export function systemdPaths(options: { homeDir: string }): { unit: string; directory: string } {
  const directory = join(options.homeDir, '.config', 'systemd', 'user')
  return { directory, unit: join(directory, SYSTEMD_UNIT) }
}

export function launchdPaths(options: { homeDir: string }): { plist: string; directory: string } {
  const directory = join(options.homeDir, 'Library', 'LaunchAgents')
  return { directory, plist: join(directory, `${LAUNCHD_LABEL}.plist`) }
}

export function autostartPaths(options: { homeDir: string }): { entry: string; directory: string } {
  const directory = join(options.homeDir, '.config', 'autostart')
  return { directory, entry: join(directory, 'clara.desktop') }
}

export function environment(options: ServicePaths): Record<string, string> {
  return {
    CLARA_CONFIG_DIR: options.configDir,
    CLARA_DATA_DIR: options.dataDir,
    CLARA_CACHE_DIR: options.cacheDir,
  }
}
