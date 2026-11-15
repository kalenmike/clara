#!/usr/bin/env node
// Rebuild Clara and restore the services that were running before the rebuild.
//
//   pnpm clara rebuild status [--json]
//   pnpm clara rebuild build [--json]
//   pnpm clara rebuild adapters [--json]
//   pnpm clara rebuild restart [--json] [--dry-run]
//   pnpm clara rebuild health [--json]
//
// The orchestration package `std:maintenance/rebuild` drives these commands one
// step at a time; they are also usable by hand.

import {
  formatAdapters,
  formatBuild,
  formatInspect,
  formatRecover,
  formatRestart,
  formatStatus,
  runAdapters,
  runBuild,
  runHealth,
  runInspect,
  runRecover,
  runRestart,
  runStatus,
  summarizeHealth,
} from '../lib/rebuild/run.mjs'

const USAGE = [
  'Clara rebuild lifecycle',
  '',
  'Usage:',
  '  pnpm clara rebuild status [--json] [--root <path>] [--state <path>]',
  '  pnpm clara rebuild build [--json] [--root <path>] [--state <path>]',
  '  pnpm clara rebuild adapters [--json] [--root <path>] [--state <path>] [--mcp|--no-mcp]',
  '  pnpm clara rebuild restart [--json] [--dry-run] [--local|--docker|--all] [--manage-external] [--force] [--skip <service>]',
  '  pnpm clara rebuild health [--json] [--state <path>] [--local|--docker|--all]',
  '  pnpm clara rebuild inspect [--json] [--state <path>] [--lines <n>]',
  '  pnpm clara rebuild recover [--json] [--local|--docker|--all] [--manage-external] [--force] [--skip <service>]',
  '',
  'Options:',
  '  --root <path>       Build checkout (default: the primary worktree)',
  '  --state <path>      Snapshot path (default: <data dir>/rebuild/setup.json)',
  '  --json              Print machine-readable JSON on stdout',
  '  --local             Manage local services only',
  '  --docker            Manage container services only (default)',
  '  --all               Manage local and container services together',
  '  --dry-run           Show the restart plan without changing services',
  '  --manage-external   Restart an orchestrator that is managed outside this checkout',
  '  --force             Ignore a stale snapshot or completed restart journal',
  '  --skip <service>    Skip web, lab, hub, or orchestrator (repeatable)',
  '  --mcp / --no-mcp    Install or skip the MCP entry',
  '  -h, --help          Show this help',
].join('\n')

function main(argv) {
  const { command, options, help } = parseArgs(argv)
  if (help || !command) {
    console.log(USAGE)
    return command ? 0 : 2
  }
  if (command === 'help') {
    console.log(USAGE)
    return 0
  }
  if (
    !['status', 'build', 'adapters', 'restart', 'health', 'inspect', 'recover'].includes(command)
  ) {
    console.error(`Unknown rebuild command: ${command}`)
    console.log(USAGE)
    return 2
  }
  return run(command, options)
}

async function run(command, options) {
  try {
    if (command === 'status') {
      const state = await runStatus(options)
      if (options.json) console.log(JSON.stringify(state, null, 2))
      else for (const line of formatStatus(state)) console.log(line)
      return 0
    }

    if (command === 'build') {
      const result = await runBuild(options)
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else for (const line of formatBuild(result)) console.log(line)
      return result.ok ? 0 : 1
    }

    if (command === 'adapters') {
      const result = await runAdapters(options)
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else for (const line of formatAdapters(result)) console.log(line)
      return result.ok ? 0 : 1
    }

    if (command === 'restart') {
      const result = await runRestart(options)
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else for (const line of formatRestart(result)) console.log(line)
      return result.ok ? 0 : 1
    }

    if (command === 'inspect') {
      const result = await runInspect(options)
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else for (const line of formatInspect(result)) console.log(line)
      return result.available ? 0 : 1
    }

    if (command === 'recover') {
      const result = await runRecover(options)
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else for (const line of formatRecover(result)) console.log(line)
      return result.ok ? 0 : 1
    }

    const report = await runHealth(options)
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else {
      for (const line of summarizeHealth(report)) console.log(line)
      console.log(`health: ${report.ok ? 'ok' : 'failed'}`)
    }
    return report.ok ? 0 : 1
  } catch (error) {
    console.error(`clara rebuild: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

function parseArgs(argv) {
  const options = { json: false, skip: [], mode: 'docker' }
  const modes = new Set()
  let command
  let help = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--local' || arg === '--docker' || arg === '--all') {
      modes.add(arg.slice(2))
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--manage-external') {
      options.manageExternal = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--mcp') {
      options.mcp = true
    } else if (arg === '--no-mcp') {
      options.mcp = false
    } else if (arg === '--root' || arg === '--state' || arg === '--skip' || arg === '--lines') {
      const value = argv[++index]
      if (!value) throw new Error(`Missing value for ${arg}`)
      if (arg === '--root') options.root = value
      else if (arg === '--state') options.statePath = value
      else if (arg === '--lines') {
        const lines = Number(value)
        if (!Number.isFinite(lines) || lines < 1)
          throw new Error('--lines must be a positive number')
        options.lines = lines
      } else {
        options.skip.push(
          ...value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => (entry === 'hub' ? 'server' : entry))
        )
      }
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${arg}`)
    } else if (!command) {
      command = arg
    } else {
      throw new Error(`Unexpected argument ${arg}`)
    }
  }

  if (modes.size > 1) throw new Error('--local, --docker, and --all cannot be combined')
  if (modes.size === 1) options.mode = [...modes][0]

  return { command, options, help }
}

process.exitCode = await main(process.argv.slice(2))
