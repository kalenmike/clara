import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** OpenCode's own config and plugin locations. */
export function opencodeHome(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'opencode')
}

export function opencodePaths(env: NodeJS.ProcessEnv = process.env) {
  const home = opencodeHome(env)
  return {
    home,
    plugins: join(home, 'plugins'),
    agents: join(home, 'agents'),
    commands: join(home, 'commands'),
    config: join(home, 'opencode.json'),
    adapterConfig: join(home, 'clara-policy.json'),
    plugin: join(home, 'plugins', 'clara-policy'),
    agent: join(home, 'agents', 'clara.md'),
    agentManifest: join(home, 'agents', '.clara-policy-agents.json'),
    command: join(home, 'commands', 'pipeline.md'),
    token: join(
      env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share'),
      'clara',
      'engine.token'
    ),
  }
}

export function exists(path: string): boolean {
  return existsSync(path)
}
