import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AdapterPaths } from './types.ts'

function configBase(env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
}

function dataBase(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
}

/** The Clara config and data roots that hold `adapters.json` and the CLI install. */
export function claraPaths(env: NodeJS.ProcessEnv = process.env): {
  configDir: string
  dataDir: string
} {
  return {
    configDir: env.CLARA_CONFIG_DIR?.trim() || join(configBase(env), 'clara'),
    dataDir: env.CLARA_DATA_DIR?.trim() || join(dataBase(env), 'clara'),
  }
}

/**
 * Resolve one adapter's files under `clara/adapters/<name>`. The explicit
 * overrides stay in place for containers and tests, and the Clara roots follow
 * the same variables the hub and CLI use.
 */
export function adapterPaths(name: string, env: NodeJS.ProcessEnv = process.env): AdapterPaths {
  const configRoot = env.CLARA_CONFIG_DIR?.trim() || join(configBase(env), 'clara')
  const dataRoot = env.CLARA_DATA_DIR?.trim() || join(dataBase(env), 'clara')
  const configDir = env.CLARA_ADAPTER_CONFIG_DIR?.trim() || join(configRoot, 'adapters', name)
  const dataDir = env.CLARA_ADAPTER_DATA_DIR?.trim() || join(dataRoot, 'adapters', name)
  return {
    name,
    configDir,
    dataDir,
    configPath: join(configDir, 'config.json'),
    identityPath: join(dataDir, 'identity.json'),
    logPath: join(dataDir, 'adapter.log'),
    pidPath: join(dataDir, 'adapter.pid'),
    statePath: join(dataDir, 'state.json'),
  }
}
