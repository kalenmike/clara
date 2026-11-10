#!/usr/bin/env node
// Combined Docker controls for the Clara stack.
//
//   pnpm clara start [--no-server] [--no-web] [--no-orchestrator] [--build]
//   pnpm clara stop [--no-server] [--no-web] [--no-orchestrator]
//   pnpm clara restart [--no-server] [--no-web] [--no-orchestrator] [--build]
//   pnpm clara status
//   pnpm clara logs <server|web|orchestrator>

import { ensureNetwork, panelURL } from './lib/server-control.mjs'
import { webURL } from './lib/web-control.mjs'
import { run, runNode } from './lib/router.mjs'
import {
  CONTAINERS,
  SCRIPTS,
  SERVICES,
  ensureOrchestratorEnv,
  orchestratorURL,
  parseSelection,
  selectedNames,
} from './lib/stack-control.mjs'

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
    logs()
    break
  default:
    console.error(`Unknown stack command: ${command}`)
    printHelp()
    process.exitCode = 2
}

async function start() {
  const selection = parseOrExit(true)
  if (!selection) return
  if (!hasSelection(selection)) return
  await startSelection(selection)
}

async function stop() {
  const selection = parseOrExit(false)
  if (!selection) return
  if (!hasSelection(selection)) return
  const code = await stopSelection(selection)
  if (code !== 0) process.exitCode = code
}

async function restart() {
  const selection = parseOrExit(true)
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
  for (const name of SERVICES) {
    console.log(`\n==> ${name}`)
    runPrimitive(name, ['status'])
  }
  process.exitCode = 0
}

function logs() {
  const name = args.find((arg) => !arg.startsWith('-'))
  if (!name || !CONTAINERS[name]) {
    console.error('Usage: pnpm clara logs <server|web|orchestrator>')
    process.exitCode = 2
    return
  }
  const code = run('docker', ['logs', '-f', CONTAINERS[name]])
  if (code !== 0) process.exitCode = code
}

async function startSelection(selection) {
  if (ensureNetwork() !== 0) {
    process.exitCode = 1
    return
  }
  if (selection.orchestrator) {
    try {
      ensureOrchestratorEnv()
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      return
    }
  }
  for (const name of selectedNames(selection)) {
    console.log(`\n==> starting ${name}`)
    const code = runPrimitive(name, ['start', '--docker', ...(selection.build ? ['--build'] : [])])
    if (code !== 0) {
      console.error(
        `\n${name} did not start. The stack is partially started; run \`pnpm clara stop\` to clean up.`
      )
      process.exitCode = code
      return
    }
  }
  printSummary(selection)
}

async function stopSelection(selection) {
  let failed = false
  for (const name of selectedNames(selection, [...SERVICES].reverse())) {
    console.log(`\n==> stopping ${name}`)
    if (runPrimitive(name, ['stop', '--docker']) !== 0) failed = true
  }
  return failed ? 1 : 0
}

function hasSelection(selection) {
  if (selectedNames(selection).length > 0) return true
  console.error('Nothing selected. Remove at least one --no-* flag.')
  process.exitCode = 2
  return false
}

function parseOrExit(allowBuild) {
  try {
    return parseSelection(args, { build: allowBuild })
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    return undefined
  }
}

function runPrimitive(name, primitiveArgs) {
  return runNode(SCRIPTS[name], primitiveArgs)
}

function printSummary(selection) {
  console.log('\nClara stack')
  if (selection.server) console.log(`  panel:        ${panelURL()}/`)
  if (selection.web) console.log(`  web:          ${webURL()}/`)
  if (selection.orchestrator) console.log(`  orchestrator: ${orchestratorURL()}/`)

  if (selection.server) {
    console.log('')
    console.log('First run: open the panel and use `pnpm clara server setup-token --docker`.')
    console.log('Pair a device with `pnpm clara server pair --docker`.')
  }
  if (!selection.web) {
    console.log('')
    console.log(
      'note: the web client is disabled; pairing links use CLARA_PAIRING_BASE_URL (default http://127.0.0.1:8080).'
    )
  }
  if (!selection.server) {
    console.log('')
    console.log(
      'note: the web client needs a home agent; it will not connect until one is available.'
    )
  }
  if (!selection.orchestrator) {
    console.log('')
    console.log('note: orchestration is disabled; the panel reports it stopped.')
  }
}

function printHelp() {
  console.log(`Manage the Clara Docker stack

Usage:
  pnpm clara start [--no-server] [--no-web] [--no-orchestrator] [--build]
  pnpm clara stop [--no-server] [--no-web] [--no-orchestrator]
  pnpm clara restart [--no-server] [--no-web] [--no-orchestrator] [--build]
  pnpm clara status
  pnpm clara logs <server|web|orchestrator>

Commands:
  start     Start the selected containers (default: all)
  stop      Stop the selected containers (default: all)
  restart   Stop then start the selected containers
  status    Probe the orchestrator, server, and web client
  logs      Follow one container's logs

Use the scoped commands for independent control:
  pnpm clara server start|stop|status
  pnpm clara web start|stop|status|logs
  pnpm clara orchestrator start|stop|status`)
}
