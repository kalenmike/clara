#!/usr/bin/env node
// Internal MCP bridge installer used by `clara start adapter --mcp`.
//
//   node tools/cli/src/commands/install-mcp.mjs install [--api] [--no-start]
//   node tools/cli/src/commands/install-mcp.mjs uninstall [--api]
//   node tools/cli/src/commands/install-mcp.mjs config
//   node tools/cli/src/commands/install-mcp.mjs status

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'
import { installCommand, removeCommand } from '../lib/clara-command.mjs'
import { dockerTokenPath, engineContainerRunning, readEngineToken } from '../lib/stack-control.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const mcpEntry = join(root, 'packages', 'orchestration', 'mcp', 'dist', 'index.js')
const apiMcpEntry = join(root, 'packages', 'api', 'mcp', 'dist', 'index.js')
const engineEntry = join(root, 'apps', 'engine', 'dist', 'index.js')
const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
const opencodeDir = join(configHome, 'opencode')
const opencodeConfig = join(opencodeDir, 'opencode.json')
const claraConfigDir = process.env.CLARA_CONFIG_DIR?.trim() || join(configHome, 'clara')
const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
const dataDir = process.env.CLARA_DATA_DIR?.trim() || join(dataHome, 'clara')
const tokenFile =
  process.env.CLARA_ENGINE_TOKEN_FILE?.trim() ||
  process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() ||
  join(dataDir, 'engine.token')
const baseURL =
  process.env.CLARA_ENGINE_URL?.trim() ||
  process.env.CLARA_ORCHESTRATION_URL?.trim() ||
  'http://127.0.0.1:8789'
const configuredApiURL = process.env.CLARA_API_URL?.trim()
const liveRuntime = readRuntimeState()
const apiBaseURL =
  configuredApiURL ||
  (isRuntimeLive(liveRuntime) && liveRuntime.local
    ? liveRuntime.local.url.replace(/\/$/, '')
    : 'http://127.0.0.1:8788')
const apiTokenFile = process.env.CLARA_API_TOKEN_FILE?.trim() || join(claraConfigDir, 'api.token')

const args = process.argv.slice(2)
const command = args[0] ?? 'install'
const noStart = args.includes('--no-start')
const withApi = args.includes('--api')

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(
    'Clara MCP bridge\n\nUsage: node tools/cli/src/commands/install-mcp.mjs <install|uninstall|config|status> [--api] [--no-start]'
  )
} else if (command === 'install') install()
else if (command === 'uninstall') uninstall()
else if (command === 'config') printConfig()
else if (command === 'status') status()
else fail(`unknown command: ${command}`)

function install() {
  if (!existsSync(mcpEntry)) {
    fail('The MCP bridge is not built. Run `pnpm --filter @clara/mcp build` first.')
  }
  if (withApi && !existsSync(apiMcpEntry)) {
    fail('The API MCP bridge is not built. Run `pnpm --filter @clara/api-mcp build` first.')
  }
  mkdirSync(opencodeDir, { recursive: true, mode: 0o700 })
  const config = readConfig()
  const mcp = isRecord(config.mcp) ? config.mcp : {}
  mcp.clara = {
    type: 'local',
    command: [process.execPath, mcpEntry],
    enabled: true,
    environment: {
      CLARA_ORCHESTRATION_URL: baseURL,
    },
  }
  if (withApi) {
    mcp['clara-api'] = apiConfig()
  }
  config.mcp = mcp
  writeConfig(config)
  console.log(`ok   OpenCode MCP entry: ${opencodeConfig}`)
  if (withApi) {
    console.log(`ok   read-only hub API MCP: ${apiBaseURL} (token ${apiTokenFile})`)
  }
  if (adapterInstalled()) {
    console.log('skip /pipeline command: the Clara agent is the entry point')
  } else {
    const command = installCommand({ force: args.includes('--force') })
    console.log(`${command.written ? 'write' : 'keep'} /pipeline command: ${command.path}`)
  }
  if (!noStart) startService()
  console.log('')
  console.log('Stdio config for other clients:')
  console.log(JSON.stringify({ mcpServers: { clara: stdioEntry() } }, null, 2))
  console.log('')
  console.log('HTTP MCP endpoint:')
  console.log(`  ${baseURL}/mcp`)
  console.log('  Authorization: Bearer <token from ' + activeTokenFile() + '>')
}

function uninstall() {
  if (!existsSync(opencodeConfig)) {
    console.log('OpenCode config not found; nothing to remove')
    return
  }
  const config = readConfig()
  const mcp = isRecord(config.mcp) ? config.mcp : {}
  const key = withApi ? 'clara-api' : 'clara'
  if (key in mcp) {
    delete mcp[key]
    config.mcp = mcp
    writeConfig(config)
    console.log(`removed mcp.${key} from ${opencodeConfig}`)
    removeCommandIfUnused(config)
  } else {
    console.log(`mcp.${key} was not configured`)
  }
}

function printConfig() {
  if (adapterInstalled()) {
    console.log('OpenCode entry: select the Clara agent')
  } else {
    console.log('OpenCode command (manual MCP mode):')
    console.log('  /pipeline <request>')
  }
  console.log('')
  const token = readToken()
  console.log('Stdio bridge:')
  console.log(JSON.stringify({ mcpServers: { clara: stdioEntry() } }, null, 2))
  console.log('')
  console.log('Read-only hub API MCP:')
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          'clara-api': {
            command: process.execPath,
            args: [apiMcpEntry],
            env: apiConfig().environment,
          },
        },
      },
      null,
      2
    )
  )
  console.log('')
  console.log('HTTP MCP:')
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          clara: {
            url: `${baseURL}/mcp`,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        },
      },
      null,
      2
    )
  )
}

async function status() {
  const ok = await fetch(`${baseURL}/health`)
    .then((response) => response.ok)
    .catch(() => false)
  console.log(`engine: ${ok ? 'running' : 'stopped'} (${baseURL})`)
  console.log(`OpenCode MCP config: ${existsSync(opencodeConfig) ? opencodeConfig : 'missing'}`)
  console.log(`MCP bridge: ${existsSync(mcpEntry) ? mcpEntry : 'not built'}`)
  console.log(`API MCP bridge: ${existsSync(apiMcpEntry) ? apiMcpEntry : 'not built'}`)
  console.log(`Hub API: ${apiBaseURL} (token ${apiTokenFile})`)
  if (adapterInstalled()) {
    console.log('OpenCode entry: Clara agent')
  } else {
    console.log(
      `/pipeline command: ${existsSync(join(configHome, 'opencode', 'commands', 'pipeline.md')) ? 'installed' : 'missing'}`
    )
  }
  if (!ok) process.exitCode = 1
}

function adapterInstalled() {
  return existsSync(join(configHome, 'opencode', 'plugins', 'clara-policy'))
}

function stdioEntry() {
  return { command: process.execPath, args: [mcpEntry] }
}

function apiConfig() {
  const environment = {
    ...runtimeEnvironment(),
    CLARA_API_TOKEN_FILE: apiTokenFile,
  }
  if (configuredApiURL) environment.CLARA_API_URL = configuredApiURL
  return {
    type: 'local',
    command: [process.execPath, apiMcpEntry],
    enabled: true,
    environment,
  }
}

/** Let the MCP resolve the live hub port from the shared runtime file. */
function runtimeEnvironment() {
  const environment = {}
  for (const key of ['CLARA_CONFIG_DIR', 'CLARA_DATA_DIR', 'CLARA_RUNTIME_FILE']) {
    const value = process.env[key]?.trim()
    if (value) environment[key] = value
  }
  return environment
}

function activeTokenFile() {
  return engineContainerRunning() ? dockerTokenPath() : tokenFile
}

function readToken() {
  if (engineContainerRunning()) {
    const dockerToken = readEngineToken(root)
    if (dockerToken) return dockerToken
  }
  if (!existsSync(tokenFile)) return ''
  return readFileSync(tokenFile, 'utf8').trim()
}

function removeCommandIfUnused(config) {
  const adapterLinked = adapterInstalled()
  const mcpStillConfigured = isRecord(config.mcp) && 'clara' in config.mcp
  if (!adapterLinked && !mcpStillConfigured) {
    const removed = removeCommand()
    if (removed.removed) console.log(`removed /pipeline command: ${removed.path}`)
  }
}

function startService() {
  if (!existsSync(engineEntry)) {
    console.log('warn engine is not built; run `pnpm --filter @clara/engine build`')
    return
  }
  const result = spawnSync(process.execPath, [engineEntry, 'start'], { stdio: 'inherit' })
  if (result.status !== 0) fail('could not start the engine')
}

function readConfig() {
  if (!existsSync(opencodeConfig)) return {}
  try {
    const parsed = JSON.parse(readFileSync(opencodeConfig, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    fail(`${opencodeConfig}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function writeConfig(config) {
  const temp = `${opencodeConfig}.tmp`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, opencodeConfig)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message) {
  console.error(`error ${message}`)
  process.exit(1)
}
