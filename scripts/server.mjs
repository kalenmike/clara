#!/usr/bin/env node
// Docker and host controls for the Clara home agent.
//
//   pnpm clara server start --docker [--build]
//   pnpm clara server stop --docker
//   pnpm clara server status
//   pnpm clara server setup-token --docker
//   pnpm clara server admin reset --docker
//   pnpm clara server pair --docker
//   pnpm clara server logs

import { existsSync } from 'node:fs'
import {
  compose,
  ensureNetwork,
  localURL,
  panelURL,
  runLocalServerProcess,
  runServerProcess,
  SERVER_ENTRY,
  status,
  waitForPanel,
} from './lib/server-control.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const docker = args.includes('--docker')
const build = args.includes('--build')

if (command === '--help' || command === '-h' || command === 'help') {
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
    runServerProcessFor(['admin', 'setup-token'])
    break
  case 'admin':
    await admin()
    break
  case 'pair':
    pair()
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
  console.log('  pnpm clara server setup-token --docker')
  console.log('The token is also written to admin-setup.txt in CLARA_SERVER_CONFIG_DIR.')
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
  const result = await status()
  console.log(`panel: ${result.panel.ok ? `running (${panelURL()})` : 'stopped'}`)
  console.log(`local: ${result.local.ok ? `running (${localURL()})` : 'stopped'}`)
  if (result.panel.ok && result.panel.body?.mode) console.log(`mode: ${result.panel.body.mode}`)
  if (result.session?.ok && result.session.body) {
    const body = result.session.body
    console.log(`auth: ${body.authenticated ? `signed in as ${body.user.username}` : 'signed out'}`)
    if (!body.authenticated) console.log(`setup: ${body.setupRequired ? 'required' : 'complete'}`)
  }
  if (result.panel.error) console.log(`panel error: ${result.panel.error}`)
  process.exitCode = result.panel.ok || result.local.ok ? 0 : 1
}

async function admin() {
  const action = args[1]
  if (action !== 'reset' && action !== 'setup-token') {
    console.error('Usage: pnpm clara server admin reset|setup-token [--docker]')
    process.exitCode = 2
    return
  }
  runServerProcessFor(['admin', action])
}

function pair() {
  runServerProcessFor(['pair', ...args.slice(1).filter((arg) => arg !== '--docker')])
}

function runServerProcessFor(serverArgs) {
  if (docker) {
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
  pnpm clara server <command> [--docker]

Commands:
  start [--docker] [--build]   Start the container (local: use pnpm clara serve)
  stop --docker                Stop and remove the container
  status                       Probe the panel and local listener
  setup-token --docker         Print the one-time panel setup token
  admin reset --docker         Reset the panel superadmin password
  pair --docker                Print a pairing code from the agent
  logs --docker                Follow container logs

Local mode stays unchanged: pnpm clara serve runs the built agent in the foreground.`)
}
