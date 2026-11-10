#!/usr/bin/env node
// Docker and local controls for the Clara web client.
//
//   pnpm clara web start [--local|--docker] [--build]
//   pnpm clara web stop [--local|--docker]
//   pnpm clara web restart [--local|--docker] [--build]
//   pnpm clara web status
//   pnpm clara web logs [--local|--docker]

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { compose, webURL, waitForWeb } from './lib/web-control.mjs'
import { ensureNetwork, probe } from './lib/server-control.mjs'
import { followLog, logPath, parseMode, startDetached, stopDetached } from './lib/local-runtime.mjs'
import { WEB_DIST } from './lib/local-web.mjs'
import { root, runPnpm } from './lib/router.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from './lib/status.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const mode = parseMode(args)
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
  case 'logs':
    logs()
    break
  default:
    console.error(`Unknown web command: ${command}`)
    printHelp()
    process.exitCode = 2
}

async function start() {
  if (mode === 'local') return startLocal()
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

async function startLocal() {
  if (build) {
    const code = runPnpm(['--filter', '@clara/web', 'build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local web build failed.')
      process.exitCode = code
      return
    }
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    console.error('The web client is not built. Run `pnpm build` first.')
    process.exitCode = 1
    return
  }

  const result = await startDetached({
    name: 'web',
    command: process.execPath,
    args: [join(root, 'scripts', 'lib', 'local-web.mjs')],
    cwd: root,
    healthy: async () => {
      const health = await probe(`${webURL()}/healthz`)
      return health.ok && health.body?.service === 'clara-web'
    },
  })

  if (result.status === 'started' || result.status === 'running') {
    console.log(`web: ${webURL()}/`)
    console.log(`  logs:  ${logPath('web')}`)
    console.log('Stop it with `pnpm clara web stop --local`.')
    return
  }
  console.error(`error: the local web client did not start (${result.status}).`)
  if (result.log) console.error(`Check ${result.log}.`)
  process.exitCode = 1
}

async function stop() {
  if (mode === 'local') return stopLocal()
  const code = compose(['down'])
  if (code !== 0) process.exitCode = code
  else console.log('web container stopped')
}

async function stopLocal() {
  const result = await stopDetached({ name: 'web' })
  if (result.status === 'stopped' || result.status === 'stale') {
    console.log(
      result.status === 'stopped' ? `stopped local web (pid ${result.pid})` : 'not running'
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
      : `could not stop the local web client: ${result.reason ?? result.status}`
  )
  process.exitCode = 1
}

async function restart() {
  if (mode === 'local') {
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

async function printStatus() {
  const [record] = await collectStatus(['web'])
  if (json) renderJSON([record])
  else renderStatus([record], { title: 'Clara web' })
  process.exitCode = statusExitCode([record])
}

async function logs() {
  if (mode === 'local') {
    await followLog('web')
    return
  }
  const code = compose(['logs', '-f', 'web'])
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(`Manage the Clara web client

Usage:
  pnpm clara web <command> [--local|--docker] [options]

Commands:
  start [--build]     Start the container, or the built SPA with --local
  stop                Stop the container, or the local server with --local
  restart [--build]   Restart the selected mode
  status [--json]     Probe the /healthz endpoint
  logs                Follow container logs, or the local log with --local

Docker is the default. Local mode serves apps/web/dist on CLARA_WEB_PORT
(default 8080) with the same /healthz contract as the container.`)
}
