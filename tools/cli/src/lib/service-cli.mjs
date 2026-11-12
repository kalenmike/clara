// Shared lifecycle for the CLI-managed services.
//
// Docker is the default. `--local` uses the PID-managed detached process. A
// service supplies its compose helpers and local hooks; start, stop, restart,
// status, and logs follow the same flow for every service.

import { existsSync } from 'node:fs'
import { followLog, parseMode, startDetached, stopDetached } from './local-runtime.mjs'
import { root, runPnpm } from './router.mjs'
import { ensureNetwork } from './server-control.mjs'
import { collectStatus, renderJSON, renderStatus, statusExitCode } from './status.mjs'

export function readServiceArgs(argv, defaultCommand = 'status') {
  const args = [...argv]
  const command = args[0] ?? defaultCommand
  return {
    args,
    command,
    help:
      command === 'help' ||
      command === '--help' ||
      command === '-h' ||
      args.includes('--help') ||
      args.includes('-h'),
    build: args.includes('--build'),
    json: args.includes('--json'),
    docker: args.includes('--docker'),
    local: args.includes('--local'),
    // Resolve lazily so commands that take both flags (pair, admin) can decide
    // for themselves instead of failing in argument parsing.
    mode: () => parseMode(args),
  }
}

export async function printServiceStatus(name, title, json) {
  const [record] = await collectStatus([name])
  if (json) renderJSON([record])
  else renderStatus([record], { title })
  process.exitCode = statusExitCode([record])
}

export async function stopLocalService(name, label) {
  const result = await stopDetached({ name })
  if (result.status === 'stopped' || result.status === 'stale') {
    console.log(
      result.status === 'stopped' ? `stopped local ${label} (pid ${result.pid})` : 'not running'
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
      : `could not stop the local ${label}: ${result.reason ?? result.status}`
  )
  process.exitCode = 1
}

export async function runServiceLifecycle(service, ctx) {
  switch (ctx.command) {
    case 'start':
      await startService(service, ctx)
      return true
    case 'stop':
      await stopService(service, ctx)
      return true
    case 'restart':
      await restartService(service, ctx)
      return true
    case 'status':
      await printServiceStatus(service.name, service.title, ctx.json)
      return true
    case 'logs':
      await followServiceLogs(service, ctx)
      return true
    default:
      return false
  }
}

async function startService(service, ctx) {
  if (ctx.mode() === 'local') return startLocal(service, ctx)
  if (service.docker.preflight && !service.docker.preflight()) return
  if (ensureNetwork() !== 0) {
    process.exitCode = 1
    return
  }
  if (service.docker.starting) console.log(service.docker.starting())
  const code = service.docker.compose([
    'up',
    '-d',
    ...(ctx.build ? ['--build'] : []),
    service.docker.service,
  ])
  if (code !== 0) {
    process.exitCode = code
    return
  }
  if (!(await service.docker.healthy())) {
    console.error(service.docker.unhealthy())
    service.docker.onUnhealthy?.()
    console.error(`Check \`pnpm clara ${service.name} logs --docker\`.`)
    process.exitCode = 1
    return
  }
  service.docker.onStarted?.()
}

async function startLocal(service, ctx) {
  if (ctx.build) {
    const code = runPnpm(['--filter', service.filter, 'build'], { cwd: root })
    if (code !== 0) {
      console.error(service.local.buildError)
      process.exitCode = code
      return
    }
  }
  if (service.local.preflight && !(await service.local.preflight())) return
  if (service.local.ready && !service.local.ready()) {
    console.error(service.local.missing)
    process.exitCode = 1
    return
  }
  if (!existsSync(service.local.entry)) {
    console.error(service.local.missing)
    process.exitCode = 1
    return
  }
  const result = await startDetached({
    name: service.name,
    command: process.execPath,
    args: [service.local.entry],
    cwd: root,
    healthy: service.local.healthy,
  })
  if (result.status === 'started' || result.status === 'running') {
    service.local.onStarted?.(result)
    return
  }
  console.error(`error: the local ${service.label} did not start (${result.status}).`)
  if (result.log) console.error(`Check ${result.log}.`)
  process.exitCode = 1
}

async function stopService(service, ctx) {
  if (ctx.mode() === 'local') return stopLocalService(service.name, service.label)
  const code = service.docker.compose(['down'])
  if (code !== 0) process.exitCode = code
  else console.log(`${service.containerLabel ?? service.label} container stopped`)
}

async function restartService(service, ctx) {
  if (ctx.mode() === 'local') {
    await stopLocalService(service.name, service.label)
    if (process.exitCode) return
    return startLocal(service, ctx)
  }
  const code = service.docker.compose(['down'])
  if (code !== 0) {
    process.exitCode = code
    return
  }
  return startService(service, ctx)
}

async function followServiceLogs(service, ctx) {
  if (ctx.mode() === 'local') {
    await followLog(service.name)
    return
  }
  const code = service.docker.compose(['logs', '-f', service.docker.service])
  if (code !== 0) process.exitCode = code
}
