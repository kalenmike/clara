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
import { logPath } from '../lib/local-runtime.mjs'
import { openPanel } from '../lib/panel.mjs'
import { root } from '../lib/router.mjs'
import {
  compose,
  detectServerTarget,
  panelURL,
  probe,
  runLocalServerProcess,
  runServerProcess,
  SERVER_ENTRY,
  serverLogTail,
  waitForPanel,
} from '../lib/server-control.mjs'
import { readServiceArgs, runServiceLifecycle } from '../lib/service-cli.mjs'
import { composeEnvValues, hubEnvErrors, hubEnvWarnings } from '../lib/stack-control.mjs'

const serverService = {
  name: 'server',
  label: 'server',
  title: 'Clara server',
  filter: '@clara/server',
  local: {
    entry: SERVER_ENTRY,
    missing: 'The hub service is not built. Run `pnpm build` first.',
    buildError: 'error: the local server build failed.',
    preflight: async () => {
      const current = await probe(`${panelURL()}/health`)
      if (current.ok && current.body?.service === 'clara-server') {
        if (current.body.mode === 'container') {
          console.error(
            'The hub is running in a container. Stop it before starting a local hub service.'
          )
          process.exitCode = 1
          return false
        }
        console.log(`panel: ${panelURL()}/ (already running locally)`)
        return false
      }
      return true
    },
    healthy: async () => {
      const health = await probe(`${panelURL()}/health`)
      return health.ok && health.body?.service === 'clara-server'
    },
    onStarted: () => {
      console.log(`panel: ${panelURL()}/`)
      console.log(`  logs:  ${logPath('server')}`)
      console.log('Stop it with `pnpm clara server stop --local`.')
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
      console.log('If this is the first run, open the panel and use the one-time setup token:')
      console.log('  pnpm clara server setup-token --docker')
      console.log('The token is also written to admin-setup.txt in the clara-server-config volume.')
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

async function admin() {
  const action = ctx.args[1]
  if (action !== 'reset' && action !== 'setup-token') {
    console.error('Usage: pnpm clara server admin reset|setup-token [--docker|--local]')
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
