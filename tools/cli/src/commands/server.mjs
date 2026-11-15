#!/usr/bin/env node
// Host controls for the Clara hub.
//
//   clara start hub [--build]
//   clara stop hub
//   clara restart hub [--build]
//   clara status hub
//   clara status hub --open
//   clara pair hub [--no-relay]
//   clara logs hub

import { existsSync } from 'node:fs'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'
import { logPath } from '../lib/local-runtime.mjs'
import { openPanel } from '../lib/panel.mjs'
import { renderCommandHelp, root } from '../lib/router.mjs'
import {
  localURL,
  panelURL,
  probe,
  runLocalServerProcess,
  SERVER_ENTRY,
} from '../lib/server-control.mjs'
import { readServiceArgs, runServiceLifecycle } from '../lib/service-cli.mjs'

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
          'The hub is running outside this installation. Stop it where it was started before starting a local hub.'
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
      console.log('  clara-server setup --password-stdin')
      console.log('Stop it with `clara stop hub`.')
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
  console.error('Start it with `clara start hub`.')
  process.exitCode = 1
}

async function setup() {
  await runServerProcessFor(['setup', ...ctx.args.slice(1)])
}

async function admin() {
  const action = ctx.args[1]
  if (action !== 'reset' && action !== 'setup-token') {
    console.error('Usage: clara-server admin reset|setup-token')
    process.exitCode = 2
    return
  }
  await runServerProcessFor(['admin', action])
}

async function pair() {
  await runServerProcessFor(['pair', ...ctx.args.slice(1)])
}

async function runServerProcessFor(serverArgs) {
  if (!existsSync(SERVER_ENTRY)) {
    console.error('The hub service is not built. Run `pnpm build` first.')
    process.exitCode = 1
    return
  }
  const code = runLocalServerProcess(serverArgs)
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(
    renderCommandHelp({
      summary: 'Manage the Clara hub',
      usage: [
        'start hub [--build]',
        'stop hub',
        'restart hub [--build]',
        'status hub [--json]',
        'status hub --open',
        'logs hub',
        'pair hub [--no-relay]',
      ],
      options: [
        { flags: '--build', description: 'build before starting' },
        { flags: '--json', description: 'machine-readable status' },
        { flags: '--open', description: 'open the hub panel' },
        { flags: '--no-relay', description: 'print a local-only pairing code' },
      ],
      examples: [
        'clara start hub',
        'clara start hub --open',
        'clara status hub --open',
        'clara pair hub --no-relay',
      ],
    })
  )
}
