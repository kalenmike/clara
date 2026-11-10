#!/usr/bin/env node
// Docker and host controls for the Clara home agent.
//
//   pnpm clara server start --docker [--build]
//   pnpm clara server stop --docker
//   pnpm clara server status
//   pnpm clara server setup-token
//   pnpm clara server admin reset [--docker|--host]
//   pnpm clara server pair [--docker|--host]
//   pnpm clara server logs --docker

import { existsSync } from 'node:fs'
import {
  compose,
  detectServerTarget,
  ensureNetwork,
  panelURL,
  runLocalServerProcess,
  runServerProcess,
  SERVER_ENTRY,
  waitForPanel,
} from './lib/server-control.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from './lib/status.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const docker = args.includes('--docker')
const host = args.includes('--host')
const build = args.includes('--build')
const json = args.includes('--json')

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
  case 'status':
    await printStatus()
    break
  case 'setup-token':
    await runServerProcessFor(['admin', 'setup-token'])
    break
  case 'admin':
    await admin()
    break
  case 'pair':
    await pair()
    break
  case 'logs':
    logs()
    break
  default:
    console.error(`Unknown server command: ${command}`)
    printHelp()
    process.exitCode = 2
}

async function start() {
  if (!docker) {
    console.error('Use `pnpm clara serve` for a local foreground agent, or `--docker`.')
    process.exitCode = 1
    return
  }
  if (ensureNetwork() !== 0) {
    process.exitCode = 1
    return
  }
  const code = compose(['up', '-d', ...(build ? ['--build'] : []), 'server'])
  if (code !== 0) {
    process.exitCode = code
    return
  }
  const health = await waitForPanel(90_000)
  if (!health) {
    console.error(`The server did not become healthy at ${panelURL()}/health`)
    console.error('Check `pnpm clara server logs --docker`.')
    process.exitCode = 1
    return
  }
  console.log(`server panel: ${panelURL()}/`)
  console.log('If this is the first run, open the panel and use the one-time setup token:')
  console.log('  pnpm clara server setup-token')
  console.log('The token is also written to admin-setup.txt in the clara-server-config volume.')
}

async function stop() {
  if (!docker) {
    console.error('Use `pnpm clara serve` to run a local foreground agent. Stop it with Ctrl-C.')
    process.exitCode = 1
    return
  }
  const code = compose(['down'])
  if (code !== 0) process.exitCode = code
  else console.log('server container stopped')
}

async function printStatus() {
  const [record] = await collectStatus(['server'])
  if (json) renderJSON([record])
  else renderStatus([record], { title: 'Clara server' })
  process.exitCode = statusExitCode([record])
}

async function admin() {
  const action = args[1]
  if (action !== 'reset' && action !== 'setup-token') {
    console.error('Usage: pnpm clara server admin reset|setup-token [--docker|--host]')
    process.exitCode = 2
    return
  }
  await runServerProcessFor(['admin', action])
}

async function pair() {
  const forwarded = args.slice(1).filter((arg) => arg !== '--docker' && arg !== '--host')
  await runServerProcessFor(['pair', ...forwarded])
}

async function runServerProcessFor(serverArgs) {
  const target = await chooseTarget()
  if (!target) {
    process.exitCode = 1
    return
  }
  console.log(
    target === 'container'
      ? '[clara] target: the clara-server container'
      : '[clara] target: the local install'
  )
  if (target === 'container') {
    const code = runServerProcess(serverArgs)
    if (code !== 0) process.exitCode = code
    return
  }
  if (!existsSync(SERVER_ENTRY)) {
    console.error('The home agent is not built. Run `pnpm build` first.')
    process.exitCode = 1
    return
  }
  const code = runLocalServerProcess(serverArgs)
  if (code !== 0) process.exitCode = code
}

async function chooseTarget() {
  const result = await detectServerTarget({ docker, local: host })
  if (result.target !== 'ambiguous') return result.target
  console.error(`Cannot choose where to run the command: ${result.reason}.`)
  console.error('Pass --docker for the clara-server container, or --host for a local install.')
  return undefined
}

function logs() {
  if (!docker) {
    console.error('Use `pnpm clara serve` to see local agent logs.')
    process.exitCode = 1
    return
  }
  const code = compose(['logs', '-f', 'server'])
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(`Manage the Clara home agent

Usage:
  pnpm clara server <command> [--docker|--host]

Commands:
  start [--docker] [--build]   Start the container (local: use pnpm clara serve)
  stop --docker                Stop and remove the container
  status [--json]              Probe the panel and local listener
  setup-token                  Print the one-time panel setup token
  admin reset                  Reset the panel superadmin password
  pair                         Print a pairing code from the agent
  logs --docker                Follow container logs

setup-token, admin, and pair target the running deployment automatically and
report which one they chose. Pass --docker for the clara-server container or
--host for a local install when both exist.
Local mode stays unchanged: pnpm clara serve runs the built agent in the foreground.`)
}
