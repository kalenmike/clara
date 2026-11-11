#!/usr/bin/env node
// Docker and local controls for the Clara hub.
//
//   pnpm clara server start [--local|--docker] [--build]
//   pnpm clara server stop [--local|--docker]
//   pnpm clara server restart [--local|--docker] [--build]
//   pnpm clara server status
//   pnpm clara server panel
//   pnpm clara server setup-token [--docker|--local]
//   pnpm clara server admin reset [--docker|--local]
//   pnpm clara server pair [--no-relay] [--docker|--local]
//   pnpm clara server logs [--local|--docker]

import { existsSync } from 'node:fs'
import {
  compose,
  detectServerTarget,
  ensureNetwork,
  panelURL,
  probe,
  runLocalServerProcess,
  runServerProcess,
  SERVER_ENTRY,
  waitForPanel,
} from './lib/server-control.mjs'
import { followLog, logPath, parseMode, startDetached, stopDetached } from './lib/local-runtime.mjs'
import { openPanel } from './lib/panel.mjs'
import { root, runPnpm } from './lib/router.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from './lib/status.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const docker = args.includes('--docker')
const local = args.includes('--local')
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
  case 'restart':
    await restart()
    break
  case 'status':
    await printStatus()
    break
  case 'panel':
    await panel()
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
  if (parseMode(args) === 'local') return startLocal()
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
  console.log(`panel: ${panelURL()}/`)
  console.log('If this is the first run, open the panel and use the one-time setup token:')
  console.log('  pnpm clara server setup-token --docker')
  console.log('The token is also written to admin-setup.txt in the clara-server-config volume.')
}

async function startLocal() {
  if (build) {
    const code = runPnpm(['--filter', '@clara/server', 'build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local server build failed.')
      process.exitCode = code
      return
    }
  }
  if (!existsSync(SERVER_ENTRY)) {
    console.error('The hub service is not built. Run `pnpm build` first.')
    process.exitCode = 1
    return
  }

  const current = await probe(`${panelURL()}/health`)
  if (current.ok && current.body?.service === 'clara-server') {
    if (current.body.mode === 'container') {
      console.error(
        'The hub is running in a container. Stop it before starting a local hub service.'
      )
      process.exitCode = 1
      return
    }
    console.log(`panel: ${panelURL()}/ (already running locally)`)
    return
  }

  const result = await startDetached({
    name: 'server',
    command: process.execPath,
    args: [SERVER_ENTRY],
    cwd: root,
    healthy: async () => {
      const health = await probe(`${panelURL()}/health`)
      return health.ok && health.body?.service === 'clara-server'
    },
  })

  if (result.status === 'started' || result.status === 'running') {
    console.log(`panel: ${panelURL()}/`)
    console.log(`  logs:  ${logPath('server')}`)
    console.log('Stop it with `pnpm clara server stop --local`.')
    return
  }
  console.error(`error: the local server did not start (${result.status}).`)
  if (result.log) console.error(`Check ${result.log}.`)
  process.exitCode = 1
}

async function stop() {
  if (parseMode(args) === 'local') return stopLocal()
  const code = compose(['down'])
  if (code !== 0) process.exitCode = code
  else console.log('server container stopped')
}

async function stopLocal() {
  const result = await stopDetached({ name: 'server' })
  if (result.status === 'stopped' || result.status === 'stale') {
    console.log(
      result.status === 'stopped' ? `stopped local server (pid ${result.pid})` : 'not running'
    )
    return
  }
  if (result.status === 'not-running') {
    console.log('not running')
    return
  }
  console.error(
    result.status === 'not-exited'
      ? `pid ${result.pid} is still running after SIGTERM`
      : `could not stop the local server: ${result.reason ?? result.status}`
  )
  process.exitCode = 1
}

async function restart() {
  if (parseMode(args) === 'local') {
    await stopLocal()
    if (process.exitCode) return
    return startLocal()
  }
  const code = compose(['down'])
  if (code !== 0) {
    process.exitCode = code
    return
  }
  return start()
}

async function panel() {
  if (process.env.CLARA_PANEL_DISABLED === '1') {
    console.error('The panel is disabled by CLARA_PANEL_DISABLED=1. Unset it and try again.')
    process.exitCode = 1
    return
  }
  const url = `${panelURL()}/`
  const health = await probe(`${panelURL()}/health`)
  if (health.ok && health.body?.service === 'clara-server') {
    console.log(`panel: ${url}`)
    openPanel(url)
    return
  }
  if (health.ok) {
    const service =
      typeof health.body?.service === 'string' ? health.body.service : 'another service'
    console.error(`${panelURL()} answered as ${service}, not the Clara hub.`)
  } else {
    console.error(`The hub service is not serving the panel at ${url}.`)
  }
  console.error(
    'Start it with `pnpm clara server start --local` or `pnpm clara server start --docker`.'
  )
  process.exitCode = 1
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
    console.error('Usage: pnpm clara server admin reset|setup-token [--docker|--local]')
    process.exitCode = 2
    return
  }
  await runServerProcessFor(['admin', action])
}

async function pair() {
  const forwarded = args.slice(1).filter((arg) => arg !== '--docker' && arg !== '--local')
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
    console.error('The hub service is not built. Run `pnpm build` first.')
    process.exitCode = 1
    return
  }
  const code = runLocalServerProcess(serverArgs)
  if (code !== 0) process.exitCode = code
}

async function chooseTarget() {
  const result = await detectServerTarget({ docker, local })
  if (result.target !== 'ambiguous') return result.target
  console.error(`Cannot choose where to run the command: ${result.reason}.`)
  console.error('Pass --docker for the clara-server container, or --local for a local install.')
  return undefined
}

async function logs() {
  if (parseMode(args) === 'local') {
    await followLog('server')
    return
  }
  const code = compose(['logs', '-f', 'server'])
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(`Manage the Clara hub

Usage:
  pnpm clara server <command> [--local|--docker] [options]

Commands:
  start [--build]              Start the container, or the local hub service with --local
  stop                         Stop the container, or the local hub service with --local
  restart [--build]            Restart the selected mode
  status [--json]              Probe the panel and local listener
  panel                        Open the hub panel in a browser
  setup-token                  Print the one-time panel setup token
  admin reset                  Reset the panel superadmin password
  pair [--no-relay]            Print a pairing code from the selected deployment
  logs                         Follow container logs, or the local log with --local

Docker is the default. Pass --local to run the built agent as a detached local
process for start, stop, restart, and logs. For setup-token, admin, and pair,
--local selects the host install and --docker selects the container. Pair with
--no-relay to emit a local-only code and print the local web app link.`)
}
