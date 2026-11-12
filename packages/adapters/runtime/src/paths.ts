import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AdapterPaths } from './types.ts'

function configBase(env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
}

function dataBase(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
}

/**
 * Resolve one adapter's files under `clara/adapters/<name>`. The explicit
 * overrides stay in place for containers and tests.
 */
export function adapterPaths(name: string, env: NodeJS.ProcessEnv = process.env): AdapterPaths {
  const configDir =
    env.CLARA_ADAPTER_CONFIG_DIR?.trim() || join(configBase(env), 'clara', 'adapters', name)
  const dataDir =
    env.CLARA_ADAPTER_DATA_DIR?.trim() || join(dataBase(env), 'clara', 'adapters', name)
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
