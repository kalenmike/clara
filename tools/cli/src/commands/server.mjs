#!/usr/bin/env node
// Docker and local controls for the Clara hub.
//
//   pnpm clara start hub [--local|--docker] [--build]
//   pnpm clara stop hub [--local|--docker]
//   pnpm clara restart hub [--local|--docker] [--build]
//   pnpm clara status hub
//   pnpm clara status hub --open
//   clara-server setup-token [--docker|--local]
//   clara-server admin reset [--docker|--local]
//   pnpm clara pair [--no-relay] [--docker|--local]
//   pnpm clara logs hub [--local|--docker]

import { existsSync } from 'node:fs'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'
import { logPath } from '../lib/local-runtime.mjs'
import { openPanel } from '../lib/panel.mjs'
import { root } from '../lib/router.mjs'
import {
  compose,
  detectServerTarget,
  localURL,
  panelURL,
  probe,
  runLocalServerProcess,
  runServerProcess,
  SERVER_ENTRY,
  serverLogTail,
  serverRunningInCompose,
  waitForPanel,
} from '../lib/server-control.mjs'
import { readServiceArgs, runServiceLifecycle } from '../lib/service-cli.mjs'
import { composeEnvValues, hubEnvErrors, hubEnvWarnings } from '../lib/stack-control.mjs'

async function serverHealthy() {
  const health = await probe(`${panelURL()}/health`)
  return health.ok && health.body?.service === 'clara-server'
}

/** The hub publishes its own pid; prefer it over a stale CLI pid file. */
function hubRuntimePid() {
  const state = readRuntimeState()
  return isRuntimeLive(state) && state.mode === 'local' ? state.pid : undefined
}

function serverPorts() {
  return [Number(new URL(panelURL()).port), Number(new URL(localURL()).port)]
}

const serverService = {
  name: 'server',
  label: 'server',
  title: 'Clara server',
  filter: '@clara/hub-server',
  local: {
    entry: SERVER_ENTRY,
    missing: 'The hub service is not built. Run `pnpm build` first.',
    buildError: 'error: the local server build failed.',
    patterns: ['apps/hub/server', 'clara-server'],
    ports: serverPorts,
    discoverPid: hubRuntimePid,
    adoptPid: hubRuntimePid,
    systemdUnit: 'clara',
    preflight: async () => {
      const current = await probe(`${panelURL()}/health`)
      if (
        current.ok &&
        current.body?.service === 'clara-server' &&
        current.body.mode === 'container'
      ) {
        console.error(
          'The hub is running in a container. Stop it before starting a local hub service.'
        )
        process.exitCode = 1
        return false
      }
      return true
    },
    healthy: serverHealthy,
    running: serverHealthy,
    onStarted: () => {
      console.log(`panel: ${panelURL()}/`)
      console.log(`  logs:  ${logPath('server')}`)
      console.log('If this is the first run, create the owner account in the panel or run:')
      console.log('  clara-server setup --local --password-stdin')
      console.log('Stop it with `pnpm clara stop hub --local`.')
    },
  },
  docker: {
    compose,
    service: 'server',
    preflight: validateDockerEnv,
    starting: () => `starting the hub container; waiting for ${panelURL()}/health`,
    healthy: () => waitForPanel(90_000),
    unhealthy: () => `The server did not become healthy at ${panelURL()}/health`,
    onUnhealthy: printServerLogTail,
    onStarted: () => {
      console.log(`panel: ${panelURL()}/`)
      console.log('If this is the first run, create the owner account in the panel or run:')
      console.log('  clara-server setup --docker --password-stdin')
      console.log('The hub starts no transports until the owner account exists.')
    },
  },
}

const ctx = readServiceArgs(process.argv.slice(2))

if (ctx.help) {
  printHelp()
  process.exit(0)
}

if (!(await runServiceLifecycle(serverService, ctx))) {
  if (ctx.command === 'panel') await panel()
  else if (ctx.command === 'setup') await setup()
  else if (ctx.command === 'setup-token') await runServerProcessFor(['admin', 'setup-token'])
  else if (ctx.command === 'admin') await admin()
  else if (ctx.command === 'pair') await pair()
  else {
    console.error(`Unknown server command: ${ctx.command}`)
    printHelp()
    process.exitCode = 2
  }
}

function validateDockerEnv() {
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

function printServerLogTail() {
  const tail = serverLogTail()
  if (!tail) return
  console.error('\nRecent hub logs:')
  for (const line of tail.split('\n')) console.error(`  ${line}`)
  console.error('')
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
    if (health.body.setupRequired) {
      console.log('Setup required: create the owner account in the panel.')
      console.log('For a headless install, run `clara-server setup --password-stdin`.')
    }
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
  console.error('Start it with `pnpm clara start hub --local` or `pnpm clara start hub --docker`.')
  process.exitCode = 1
}

async function setup() {
  const forwarded = ctx.args.slice(1).filter((arg) => arg !== '--docker' && arg !== '--local')
  await runServerProcessFor(['setup', ...forwarded])
}

async function admin() {
  const action = ctx.args[1]
  if (action !== 'reset' && action !== 'setup-token') {
    console.error('Usage: clara-server admin reset|setup-token [--docker|--local]')
    process.exitCode = 2
    return
  }
  await runServerProcessFor(['admin', action])
}

async function pair() {
  const forwarded = ctx.args.slice(1).filter((arg) => arg !== '--docker' && arg !== '--local')
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
    if (serverArgs[0] === 'setup' && !serverRunningInCompose()) {
      console.error('The clara-server container is not running.')
      console.error('Start it with `pnpm clara start hub` before creating the owner account.')
      process.exitCode = 1
      return
    }
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
  const result = await detectServerTarget({ docker: ctx.docker, local: ctx.local })
  if (result.target !== 'ambiguous') return result.target
  console.error(`Cannot choose where to run the command: ${result.reason}.`)
  console.error('Pass --docker for the clara-server container, or --local for a local install.')
  return undefined
}

function printHelp() {
  console.log(`Manage the Clara hub

Usage:
  pnpm clara <command> hub [--local|--docker] [options]

Commands:
  start [--build]              Start the container, or the local hub service with --local
  stop                         Stop the container, or the local hub service with --local
  restart [--build]            Restart the selected mode
  status [--json]              Probe the panel and local listener
  panel                        Open the hub panel in a browser
  setup                        Create the owner account without a browser
  setup-token                  Print a host-supplied setup token, when one is configured
  admin reset                  Reset the panel superadmin password
  pair [--no-relay]            Print a pairing code from the selected deployment
  logs                         Follow container logs, or the local log with --local

Docker is the default. Pass --local to run the built agent as a detached local
process for start, stop, restart, and logs. For setup, setup-token, admin, and
pair, --local selects the host install and --docker selects the container.
Pair with --no-relay to emit a local-only code and print the local web app link.

'clara-server setup --password-stdin' reads the owner password from stdin.
It works after the hub has started in setup mode. For unattended start, set
CLARA_ADMIN_PASSWORD or CLARA_ADMIN_PASSWORD_FILE before the hub starts.`)
}
