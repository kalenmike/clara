import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Every path the packaged command owns. The hub and engine already read
 * `CLARA_CONFIG_DIR` and `CLARA_DATA_DIR`, so the CLI uses the same directories
 * instead of introducing a second install layout.
 */
export type ClaraPaths = {
  configDir: string
  dataDir: string
  cacheDir: string
  logDir: string
  stateFile: string
  supervisorPidFile: string
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ClaraPaths {
  const configDir =
    env.CLARA_CONFIG_DIR?.trim() ||
    join(env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config'), 'clara')
  const dataDir =
    env.CLARA_DATA_DIR?.trim() ||
    join(env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share'), 'clara')
  const cacheDir =
    env.CLARA_CACHE_DIR?.trim() ||
    join(env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache'), 'clara')

  return {
    configDir,
    dataDir,
    cacheDir,
    logDir: join(dataDir, 'logs'),
    stateFile: join(dataDir, 'services.json'),
    supervisorPidFile: join(dataDir, 'supervisor.pid'),
  }
}

export function serviceLogPath(dataDir: string, service: string): string {
  return join(dataDir, 'logs', `${service}.log`)
}
