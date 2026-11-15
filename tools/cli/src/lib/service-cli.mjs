// Shared lifecycle for the CLI-managed services.
//
// Docker is the default. `--local` uses the PID-managed detached process. A
// service supplies its compose helpers and local hooks; start, stop, restart,
// status, and logs follow the same flow for every service.

import { existsSync } from 'node:fs'
import {
  followLog,
  parseMode,
  recordPid,
  startDetached,
  stopDetached,
  systemdUnitActive,
} from './local-runtime.mjs'
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

export async function stopLocalService(service) {
  const local = service.local ?? {}
  if (local.systemdUnit && systemdUnitActive(local.systemdUnit) === true) {
    console.error(
      `The local ${service.label} is managed by the systemd unit "${local.systemdUnit}".`
    )
    console.error(`Stop it with \`systemctl --user stop ${local.systemdUnit}\`.`)
    process.exitCode = 1
    return
  }

  const ports = typeof local.ports === 'function' ? local.ports() : (local.ports ?? [])
  const result = await stopDetached({
    name: service.name,
    patterns: local.patterns ?? [],
    ports,
    discover: local.discoverPid ? async () => local.discoverPid() : undefined,
  })

  if (result.status === 'stopped') {
    const forced = result.escalated ? ', forced' : ''
    console.log(`stopped local ${service.label} (pid ${result.pid}${forced})`)
    return
  }
  if (result.status === 'stale' || result.status === 'not-running') {
    if (local.running && (await local.running())) {
      console.error(`The local ${service.label} is answering but no stoppable process was found.`)
      console.error('It may have been started outside this checkout; stop it where it was started.')
      process.exitCode = 1
      return
    }
    console.log('not running')
    return
  }
  if (result.status === 'foreign') {
    const command = result.command ? ` (${result.command})` : ''
    console.error(
      `pid ${result.pid} from the ${result.source} is not the local ${service.label}${command}.`
    )
    console.error('Nothing was signalled.')
    process.exitCode = 1
    return
  }
  console.error(
    result.status === 'not-exited'
      ? `pid ${result.pid} is still running after SIGKILL`
      : `could not stop the local ${service.label}: ${result.reason ?? result.status}`
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
    console.error(
      `Check \`clara logs ${service.name === 'server' ? 'hub' : service.name} --docker\`.`
    )
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
    if (result.status === 'running' && service.local.adoptPid) {
      const pid = await service.local.adoptPid()
      if (recordPid(service.name, pid)) {
        console.log(`noted the running local ${service.label} (pid ${pid}) for stop`)
      } else {
        console.warn(
          `warning: the local ${service.label} is running but did not report a pid; \`stop --local\` may not find it.`
        )
      }
    }
    service.local.onStarted?.(result)
    return
  }
  console.error(`error: the local ${service.label} did not start (${result.status}).`)
  if (result.log) console.error(`Check ${result.log}.`)
  process.exitCode = 1
}

async function stopService(service, ctx) {
  if (ctx.mode() === 'local') return stopLocalService(service)
  const code = service.docker.compose(['down'])
  if (code !== 0) process.exitCode = code
  else console.log(`${service.containerLabel ?? service.label} container stopped`)
}

async function restartService(service, ctx) {
  if (ctx.mode() === 'local') {
    await stopLocalService(service)
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
