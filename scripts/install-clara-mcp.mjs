#!/usr/bin/env node
// Install the Clara MCP bridge into OpenCode, or print generic MCP config.
//
//   pnpm clara mcp install
//   pnpm clara mcp install --no-start
//   pnpm clara mcp uninstall
//   pnpm clara mcp config
//   pnpm clara mcp status

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { installCommand, removeCommand } from './lib/clara-command.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mcpEntry = join(root, 'apps', 'mcp', 'dist', 'index.js')
const orchestratorEntry = join(root, 'apps', 'orchestrator', 'dist', 'index.js')
const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
const opencodeDir = join(configHome, 'opencode')
const opencodeConfig = join(opencodeDir, 'opencode.json')
const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
const dataDir = process.env.CLARA_DATA_DIR?.trim() || join(dataHome, 'clara')
const tokenFile =
  process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || join(dataDir, 'orchestrator.token')
const baseURL = process.env.CLARA_ORCHESTRATION_URL?.trim() || 'http://127.0.0.1:8789'

const args = process.argv.slice(2)
const command = args[0] ?? 'install'
const noStart = args.includes('--no-start')

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(
    'Clara MCP bridge\n\nUsage: pnpm clara mcp <install|uninstall|config|status> [--no-start]'
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
  config.mcp = mcp
  writeConfig(config)
  console.log(`ok   OpenCode MCP entry: ${opencodeConfig}`)
  const command = installCommand({ force: args.includes('--force') })
  console.log(`${command.written ? 'write' : 'keep'} /pipeline command: ${command.path}`)
  if (!noStart) startService()
  console.log('')
  console.log('Stdio config for other clients:')
  console.log(JSON.stringify({ mcpServers: { clara: stdioEntry() } }, null, 2))
  console.log('')
  console.log('HTTP MCP endpoint:')
  console.log(`  ${baseURL}/mcp`)
  console.log('  Authorization: Bearer <token from ' + tokenFile + '>')
}

function uninstall() {
  if (!existsSync(opencodeConfig)) {
    console.log('OpenCode config not found; nothing to remove')
    return
  }
  const config = readConfig()
  if (isRecord(config.mcp) && 'clara' in config.mcp) {
    delete config.mcp.clara
    writeConfig(config)
    console.log(`removed mcp.clara from ${opencodeConfig}`)
    removeCommandIfUnused(config)
  } else {
    console.log('mcp.clara was not configured')
  }
}

function printConfig() {
  console.log('OpenCode command:')
  console.log('  /pipeline <request>')
  console.log('')
  const token = readToken()
  console.log('Stdio bridge:')
  console.log(JSON.stringify({ mcpServers: { clara: stdioEntry() } }, null, 2))
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
  console.log(`orchestrator: ${ok ? 'running' : 'stopped'} (${baseURL})`)
  console.log(`OpenCode MCP config: ${existsSync(opencodeConfig) ? opencodeConfig : 'missing'}`)
  console.log(`MCP bridge: ${existsSync(mcpEntry) ? mcpEntry : 'not built'}`)
  console.log(
    `/pipeline command: ${existsSync(join(configHome, 'opencode', 'commands', 'pipeline.md')) ? 'installed' : 'missing'}`
  )
  if (!ok) process.exitCode = 1
}

function stdioEntry() {
  return { command: process.execPath, args: [mcpEntry] }
}

function readToken() {
  if (!existsSync(tokenFile)) return ''
  return readFileSync(tokenFile, 'utf8').trim()
}

function removeCommandIfUnused(config) {
  const adapterInstalled = existsSync(join(configHome, 'opencode', 'plugins', 'clara-policy'))
  const mcpStillConfigured = isRecord(config.mcp) && 'clara' in config.mcp
  if (!adapterInstalled && !mcpStillConfigured) {
    const removed = removeCommand()
    if (removed.removed) console.log(`removed /pipeline command: ${removed.path}`)
  }
}

function startService() {
  if (!existsSync(orchestratorEntry)) {
    console.log('warn orchestrator is not built; run `pnpm --filter @clara/orchestrator build`')
    return
  }
  const result = spawnSync(process.execPath, [orchestratorEntry, 'start'], { stdio: 'inherit' })
  if (result.status !== 0) fail('could not start the orchestrator')
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
