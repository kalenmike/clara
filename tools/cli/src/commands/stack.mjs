#!/usr/bin/env node
// Combined Docker controls for the Clara stack.
//
//   pnpm clara start [--no-server] [--no-web] [--no-orchestrator] [--build]
//   pnpm clara stop [--no-server] [--no-web] [--no-orchestrator]
//   pnpm clara restart [--no-server] [--no-web] [--no-orchestrator] [--build]
//   pnpm clara status
//   pnpm clara logs <server|web|orchestrator>

import { existsSync } from 'node:fs'
import { ensureNetwork, panelURL } from '../lib/server-control.mjs'
import { webURL } from '../lib/web-control.mjs'
import { followLog, parseMode } from '../lib/local-runtime.mjs'
import { root, runNode, runPnpm } from '../lib/router.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from '../lib/status.mjs'
import {
  CONTAINERS,
  SCRIPTS,
  SERVICES,
  composeEnvValues,
  ensureOrchestratorEnv,
  hubEnvErrors,
  hubEnvWarnings,
  orchestratorURL,
  parseSelection,
  selectedNames,
} from '../lib/stack-control.mjs'
import {
  existingVolumes,
  parseBackupArgs,
  parseRestoreArgs,
  runBackup,
  runRestore,
  runningContainers,
} from '../lib/stack-backup.mjs'

const command = process.argv[2] ?? 'help'
const args = process.argv.slice(3)

if (
  command === '--help' ||
  command === '-h' ||
  command === 'help' ||
  args.includes('--help') ||
  args.includes('-h')
) {
  printHelp()
  process.exit(0)
}

switch (command) {
  case 'start':
    await start()
    break
  case 'stop':
    await stop()
    break
  case 'restart':
    await restart()
    break
  case 'status':
    await status()
    break
  case 'logs':
    await logs()
    break
  case 'backup':
    backup()
    break
  case 'restore':
    restore()
    break
  default:
    console.error(`Unknown stack command: ${command}`)
    printHelp()
    process.exitCode = 2
}

async function start() {
  const selection = parseOrExit({ build: true })
  if (!selection) return
  if (!hasSelection(selection)) return
  await startSelection(selection)
}

async function stop() {
  const selection = parseOrExit({ build: false })
  if (!selection) return
  if (!hasSelection(selection)) return
  const code = await stopSelection(selection)
  if (code !== 0) process.exitCode = code
}

async function restart() {
  const selection = parseOrExit({ build: true })
  if (!selection) return
  if (!hasSelection(selection)) return
  const stopCode = await stopSelection(selection)
  if (stopCode !== 0) {
    process.exitCode = stopCode
    return
  }
  await startSelection(selection)
}

async function status() {
  const selection = parseOrExit({ build: false, json: true })
  if (!selection) return
  if (!hasSelection(selection)) return
  const records = await collectStatus(selectedNames(selection))
  if (selection.json) renderJSON(records, { stack: true })
  else renderStatus(records, { title: 'Clara stack' })
  process.exitCode = statusExitCode(records)
}

async function logs() {
  const name = args.find((arg) => !arg.startsWith('-'))
  if (!name || !CONTAINERS[name]) {
    console.error('Usage: pnpm clara logs <server|web|orchestrator> [--local|--docker]')
    process.exitCode = 2
    return
  }
  const mode = parseMode(args)
  if (mode === 'local' && name === 'orchestrator') {
    await followLog('orchestrator')
    return
  }
  const code = runNode(SCRIPTS[name], ['logs', mode === 'local' ? '--local' : '--docker'])
  if (code !== 0) process.exitCode = code
}

function backup() {
  let options
  try {
    options = parseBackupArgs(args)
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    return
  }
  if (refuseRunning('back up')) return

  const volumes = existingVolumes()
  if (!volumes.length) {
    console.error('error: no Clara volumes found. Start the stack once before backing it up.')
    process.exitCode = 1
    return
  }

  console.log(`writing ${options.output}`)
  try {
    const code = runBackup({ output: options.output, volumes })
    if (code !== 0) {
      console.error('error: backup failed')
      process.exitCode = code
      return
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }
  console.log(`backup written to ${options.output}`)
}

function restore() {
  let options
  try {
    options = parseRestoreArgs(args)
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    return
  }
  if (!existsSync(options.archive)) {
    console.error(`error: archive not found: ${options.archive}`)
    process.exitCode = 1
    return
  }
  if (refuseRunning('restore')) return

  const volumes = existingVolumes()
  if (volumes.length && !options.force) {
    console.error(
      `error: refusing to overwrite ${volumes.join(', ')}. Re-run with --force to replace the volume contents.`
    )
    process.exitCode = 1
    return
  }

  console.log(`restoring ${options.archive}`)
  try {
    const code = runRestore({ archive: options.archive })
    if (code !== 0) {
      console.error('error: restore failed')
      process.exitCode = code
      return
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }
  console.log('restore complete; start the stack with `pnpm clara start`')
}

function refuseRunning(action) {
  const containers = runningContainers()
  if (containers.length === 0) return false
  console.error(
    `error: cannot ${action} while ${containers.join(', ')} ${containers.length === 1 ? 'is' : 'are'} running. Run \`pnpm clara stop\` first.`
  )
  process.exitCode = 1
  return true
}

async function startSelection(selection) {
  if (selection.mode === 'local' && selection.build) {
    console.log('\n==> building the local checkout')
    const code = runPnpm(['build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local build failed; nothing was started.')
      process.exitCode = code
      return
    }
  }
  if (selection.mode === 'docker' && selection.server && !validateHubEnv()) return
  if (selection.mode === 'docker' && selection.orchestrator) {
    try {
      ensureOrchestratorEnv()
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      return
    }
  }
  if (selection.mode === 'docker' && ensureNetwork() !== 0) {
    process.exitCode = 1
    return
  }
  const modeArgs = selection.mode === 'local' ? ['--local'] : ['--docker']
  for (const name of selectedNames(selection)) {
    console.log(`\n==> starting ${name} (${selection.mode})`)
    const code = runPrimitive(name, [
      'start',
      ...modeArgs,
      ...(selection.mode === 'docker' && selection.build ? ['--build'] : []),
    ])
    if (code !== 0) {
      console.error(
        `\n${name} did not start. The stack is partially started; run \`pnpm clara stop ${modeArgs[0]}\` to clean up.`
      )
      process.exitCode = code
      return
    }
  }
  printSummary(selection)
}

async function stopSelection(selection) {
  const modeArgs = selection.mode === 'local' ? ['--local'] : ['--docker']
  let failed = false
  for (const name of selectedNames(selection, [...SERVICES].reverse())) {
    console.log(`\n==> stopping ${name} (${selection.mode})`)
    if (runPrimitive(name, ['stop', ...modeArgs]) !== 0) failed = true
  }
  return failed ? 1 : 0
}

function hasSelection(selection) {
  if (selectedNames(selection).length > 0) return true
  console.error('Nothing selected. Remove at least one --no-* flag.')
  process.exitCode = 2
  return false
}

function parseOrExit(options) {
  try {
    return parseSelection(args, options)
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    return undefined
  }
}

function validateHubEnv() {
  const values = composeEnvValues()
  const errors = hubEnvErrors(values)
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`)
    process.exitCode = 1
    return false
  }
  for (const warning of hubEnvWarnings(values)) console.warn(`warning: ${warning}`)
  return true
}

function runPrimitive(name, primitiveArgs) {
  return runNode(SCRIPTS[name], primitiveArgs)
}

function printSummary(selection) {
  console.log(`\nClara stack (${selection.mode})`)
  if (selection.server) console.log(`  panel:        ${panelURL()}/`)
  if (selection.web) console.log(`  web:          ${webURL()}/`)
  if (selection.orchestrator) console.log(`  orchestrator: ${orchestratorURL()}/`)

  if (selection.server) {
    const target = selection.mode === 'local' ? '--local' : '--docker'
    console.log('')
    console.log('Open the panel with `pnpm clara server panel`.')
    console.log(
      `First run: create the owner account in the panel, or run \`pnpm clara server setup ${target} --password-stdin\`.`
    )
    console.log(`Pair a device with \`pnpm clara server pair ${target}\`.`)
    console.log('Add `--no-relay` to that pair command for a local-only code and local link.')
  }
  if (!selection.web) {
    console.log('')
    console.log(
      `note: the web client is disabled; pairing links use the panel Web URL (default ${webURL()}).`
    )
  }
  if (!selection.server) {
    console.log('')
    console.log('note: the web client needs a hub; it will not connect until one is available.')
  }
  if (!selection.orchestrator) {
    console.log('')
    console.log('note: orchestration is disabled; the panel reports it stopped.')
  }
}

function printHelp() {
  console.log(`Manage the Clara stack

Usage:
  pnpm clara start [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build]
  pnpm clara stop [--local|--docker] [--no-server] [--no-web] [--no-orchestrator]
  pnpm clara restart [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build]
  pnpm clara status [--no-server] [--no-web] [--no-orchestrator] [--json]
  pnpm clara logs <server|web|orchestrator> [--local|--docker]
  pnpm clara backup [--output <path>]
  pnpm clara restore <archive> [--force]

Commands:
  start     Start the selected services (Docker by default)
  stop      Stop the selected services
  restart   Stop then start the selected services
  status    Probe the selected services; use --json for machines
  logs      Follow one service's logs
  backup    Archive the Docker state volumes; stop the stack first
  restore   Replace the Docker state volumes from an archive

Pass --local to run the selected services as detached local processes, or
--docker for the explicit default. --build rebuilds before starting in either
mode.

Use the scoped commands for independent control:
  pnpm clara server start|stop|restart|status|panel
  pnpm clara web start|stop|restart|status|logs
  pnpm clara orchestrator start|stop|restart|status`)
}
