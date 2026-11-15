#!/usr/bin/env node
// Host and Docker controls for the Clara engine.
//
//   clara start engine [--local|--docker] [--build]
//   clara stop engine [--local|--docker]
//   clara restart engine [--local|--docker] [--build]
//   clara status engine

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { followLog } from '../lib/local-runtime.mjs'
import { renderCommandHelp, root, run, runNode, runPnpm } from '../lib/router.mjs'
import { printServiceStatus, readServiceArgs } from '../lib/service-cli.mjs'
import {
  composeEnvValues,
  engineContainerRunning,
  engineEnvErrors,
  readEngineToken,
} from '../lib/stack-control.mjs'

const source = join(root, 'apps', 'orchestrator', 'src', 'index.ts')
const built = join(root, 'apps', 'orchestrator', 'dist', 'index.js')
const composeFile = join(root, 'infra', 'docker', 'engine.compose.yml')
const envFile = join(root, 'infra', 'docker', '.env')
const ctx = readServiceArgs(process.argv.slice(2), 'help')
const dockerToken =
  !process.env.CLARA_ENGINE_TOKEN &&
  !process.env.CLARA_ORCHESTRATION_TOKEN &&
  !process.env.CLARA_ENGINE_TOKEN_FILE &&
  !process.env.CLARA_ORCHESTRATION_TOKEN_FILE &&
  engineContainerRunning()
    ? readEngineToken()
    : ''
const env = dockerToken ? { CLARA_ENGINE_TOKEN: dockerToken } : undefined

if (ctx.help) {
  printHelp()
} else if (ctx.command === 'status') {
  await printServiceStatus('engine', 'Clara engine', ctx.json)
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
    const code = runPnpm(['--filter', '@clara/engine', 'build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local engine build failed.')
      return code
    }
  }
  if (mode === 'docker' && name === 'start' && !engineContainerRunning() && !validateDockerEnv()) {
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
  const errors = engineEnvErrors(composeEnvValues())
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
    await followLog('engine')
    return
  }
  const envArgs = existsSync(envFile) ? ['--env-file', envFile] : []
  const code = run('docker', ['compose', ...envArgs, '-f', composeFile, 'logs', '-f', 'engine'])
  if (code !== 0) process.exitCode = code
}

function printHelp() {
  console.log(
    renderCommandHelp({
      summary: 'Manage the Clara engine',
      usage: [
        'start engine [--docker|--local] [--build] [--foreground]',
        'stop engine [--docker|--local]',
        'restart engine [--docker|--local] [--build]',
        'status engine [--json]',
        'logs engine [--docker|--local] [--lines <n>] [--no-follow]',
      ],
      options: [
        { flags: '--docker', description: 'use the clara-engine container (default)' },
        { flags: '--local', description: 'use the PID-managed local service' },
        { flags: '--build', description: 'build before starting' },
        { flags: '--foreground', description: 'start: run the local service in the foreground' },
        { flags: '--json', description: 'machine-readable status' },
        { flags: '--lines <n>', description: 'tail length (default 80)' },
        { flags: '--no-follow', description: 'print the tail and exit' },
      ],
      examples: [
        'clara start engine',
        'clara start engine --foreground',
        'clara status engine',
        'clara logs engine --local',
      ],
    })
  )
}
