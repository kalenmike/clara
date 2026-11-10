#!/usr/bin/env node
// Docker controls for the Clara web client.
//
//   pnpm clara web start --docker [--build]
//   pnpm clara web stop --docker
//   pnpm clara web status
//   pnpm clara web logs --docker

import { compose, webURL, waitForWeb } from './lib/web-control.mjs'
import { ensureNetwork } from './lib/server-control.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from './lib/status.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const docker = args.includes('--docker')
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
  case 'logs':
    logs()
    break
  default:
    console.error(`Unknown web command: ${command}`)
    printHelp()
    process.exitCode = 2
}

async function start() {
  if (!docker) {
    console.error('Use `pnpm dev:web` for the Vite dev server, or `--docker` for the container.')
    process.exitCode = 1
    return
  }
  if (ensureNetwork() !== 0) {
    process.exitCode = 1
    return
  }
  const code = compose(['up', '-d', ...(build ? ['--build'] : []), 'web'])
  if (code !== 0) {
    process.exitCode = code
    return
  }
  const health = await waitForWeb(90_000)
  if (!health) {
    console.error(`The web container did not become healthy at ${webURL()}/healthz`)
    console.error('Check `pnpm clara web logs --docker`.')
    process.exitCode = 1
    return
  }
  console.log(`web: ${webURL()}/`)
  console.log('Run `pnpm clara server pair` for the agent pairing mode, or add --local')
  console.log('to force a local code.')
  console.log('An HTTPS page cannot open a ws:// socket; remote clients need the relay.')
}

async function stop() {
  if (!docker) {
    console.error('Use `pnpm dev:web` to run the Vite dev server, and Ctrl-C to stop it.')
    process.exitCode = 1
    return
  }
  const code = compose(['down'])
  if (code !== 0) process.exitCode = code
  else console.log('web container stopped')
}

async function printStatus() {
  const [record] = await collectStatus(['web'])
  if (json) renderJSON([record])
  else renderStatus([record], { title: 'Clara web' })
  process.exitCode = statusExitCode([record])
}

function logs() {
  if (!docker) {
    console.error('Use `pnpm dev:web` to see local Vite logs.')
    process.exitCode = 1
    return
  }
  const code = compose(['logs', '-f', 'web'])
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(`Manage the Clara web client container

Usage:
  pnpm clara web <command> [--docker]

Commands:
  start --docker [--build]   Start the static container
  stop --docker              Stop and remove the container
  status [--json]            Probe the /healthz endpoint
  logs --docker              Follow container logs

Local development stays unchanged: pnpm dev:web runs the Vite dev server.`)
}
