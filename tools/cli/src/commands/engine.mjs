#!/usr/bin/env node
// Host controls for the Clara engine.
//
//   clara start engine [--build]
//   clara stop engine
//   clara restart engine [--build]
//   clara status engine
//   clara logs engine

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { followLog } from '../lib/local-runtime.mjs'
import { renderCommandHelp, root, runNode, runPnpm } from '../lib/router.mjs'
import { printServiceStatus, readServiceArgs } from '../lib/service-cli.mjs'

const source = join(root, 'apps', 'engine', 'src', 'index.ts')
const built = join(root, 'apps', 'engine', 'dist', 'index.js')
const ctx = readServiceArgs(process.argv.slice(2), 'help')

if (ctx.help) {
  printHelp()
} else if (ctx.command === 'status') {
  await printServiceStatus('engine', 'Clara engine', ctx.json)
} else if (ctx.command === 'start' || ctx.command === 'stop' || ctx.command === 'restart') {
  process.exitCode = await runLifecycle(ctx.command)
} else if (ctx.command === 'logs') {
  await followLog('engine')
} else {
  runService(ctx.args)
}

async function runLifecycle(name) {
  if (name === 'restart') {
    const stopped = lifecycle('stop')
    if (stopped !== 0) return stopped
    return lifecycle('start')
  }
  return lifecycle(name)
}

function lifecycle(name) {
  if (ctx.build && name === 'start') {
    const code = runPnpm(['--filter', '@clara/engine', 'build'], { cwd: root })
    if (code !== 0) {
      console.error('error: the local engine build failed.')
      return code
    }
  }
  return runService([name])
}

function runService(serviceArgs) {
  if (existsSync(source)) {
    return runNode(source, serviceArgs, {
      nodeArgs: ['--experimental-strip-types', '--no-warnings'],
    })
  }
  if (existsSync(built)) {
    return runNode(built, serviceArgs)
  }
  console.error(
    'The orchestration service is not built and its source is missing. Run `pnpm build` first.'
  )
  return 1
}

function printHelp() {
  console.log(
    renderCommandHelp({
      summary: 'Manage the Clara engine',
      usage: [
        'start engine [--build] [--foreground]',
        'stop engine',
        'restart engine [--build]',
        'status engine [--json]',
        'logs engine [--lines <n>] [--no-follow]',
      ],
      options: [
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
        'clara logs engine',
      ],
    })
  )
}
