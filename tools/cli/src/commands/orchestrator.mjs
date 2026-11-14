#!/usr/bin/env node
// Host and Docker controls for the Clara orchestration service.
//
//   pnpm clara start orchestrator [--local|--docker] [--build]
//   pnpm clara stop orchestrator [--local|--docker]
//   pnpm clara restart orchestrator [--local|--docker] [--build]
//   pnpm clara status orchestrator

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { followLog } from '../lib/local-runtime.mjs'
import { root, run, runNode, runPnpm } from '../lib/router.mjs'
import { printServiceStatus, readServiceArgs } from '../lib/service-cli.mjs'
import {
  composeEnvValues,
  orchestratorContainerRunning,
  orchestratorEnvErrors,
  readDockerToken,
} from '../lib/stack-control.mjs'

const source = join(root, 'apps', 'orchestrator', 'src', 'index.ts')
const built = join(root, 'apps', 'orchestrator', 'dist', 'index.js')
const composeFile = join(root, 'infra', 'docker', 'orchestrator.compose.yml')
const envFile = join(root, 'infra', 'docker', '.env')
const ctx = readServiceArgs(process.argv.slice(2), 'help')
const dockerToken =
  !process.env.CLARA_ORCHESTRATION_TOKEN &&
  !process.env.CLARA_ORCHESTRATION_TOKEN_FILE &&
  orchestratorContainerRunning()
    ? readDockerToken()
    : ''
const env = dockerToken ? { CLARA_ORCHESTRATION_TOKEN: dockerToken } : undefined

if (ctx.help) {
  printHelp()
} else if (ctx.command === 'status') {
  await printServiceStatus('orchestrator', 'Clara orchestrator', ctx.json)
} else if (ctx.command === 'start' || ctx.command === 'stop' || ctx.command === 'restart') {
  process.exitCode = await runLifecycle(ctx.command)
} else if (ctx.command === 'logs') {
  await logs()
} else {
  runService(ctx.args)
}

async function runLifecycle(name) {
  const mode = ctx.mode()
  if (name === 'restart') {
    const stopped = await lifecycle('stop', mode)
    if (stopped !== 0) return stopped
    return lifecycle('start', mode)
  }
  return lifecycle(name, mode)
}

async function lifecycle(name, mode) {
  if (mode === 'local' && ctx.build && name === 'start') {
    const code = runPnpm(['--filter', '@clara/orchestrator', 'build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local orchestrator build failed.')
      return code
    }
  }
  if (
    mode === 'docker' &&
    name === 'start' &&
    !orchestratorContainerRunning() &&
    !validateDockerEnv()
  ) {
    return 1
  }
  const forwarded = [
    name,
    ...(mode === 'docker' ? ['--docker'] : []),
    ...(mode === 'docker' && ctx.build ? ['--build'] : []),
  ]
  return runService(forwarded)
}

function validateDockerEnv() {
  const errors = orchestratorEnvErrors(composeEnvValues())
  if (!errors.length) return true
  for (const error of errors) console.error(`error: ${error}`)
  return false
}

function runService(serviceArgs) {
  if (existsSync(source)) {
    return runNode(source, serviceArgs, {
      nodeArgs: ['--experimental-strip-types', '--no-warnings'],
      ...(env ? { env } : {}),
    })
  }
  if (existsSync(built)) {
    return runNode(built, serviceArgs, { ...(env ? { env } : {}) })
  }
  console.error(
    'The orchestration service is not built and its source is missing. Run `pnpm build` first.'
  )
  return 1
}

async function logs() {
  if (ctx.mode() === 'local') {
    await followLog('orchestrator')
    return
  }
  const envArgs = existsSync(envFile) ? ['--env-file', envFile] : []
  const code = run('docker', [
    'compose',
    ...envArgs,
    '-f',
    composeFile,
    'logs',
    '-f',
    'orchestrator',
  ])
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(`Run the Clara orchestration service

Usage:
  pnpm clara <command> orchestrator [--local|--docker] [options]

Commands:
  start [--build]     Start the container, or the local service with --local
  stop                Stop the container, or the local service with --local
  restart [--build]   Restart the selected mode
  serve               Run the local service in the foreground
  status [--json]     Probe the service
  logs                Follow container logs, or the local log with --local
  analyze             Analyze run history for failure patterns
  inspect             Read one failed run's evidence
  token               Print the active bearer token

Docker is the default. Pass --local to use the PID-managed local service.`)
}
