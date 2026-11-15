#!/usr/bin/env node
// Host controls for the Clara web client.
//
//   clara start web [--build]
//   clara stop web
//   clara restart web [--build]
//   clara status web
//   clara logs web

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logPath } from '../lib/local-runtime.mjs'
import { WEB_DIST, webPort, webURL } from '../lib/local-web.mjs'
import { renderCommandHelp, root } from '../lib/router.mjs'
import { probe } from '../lib/server-control.mjs'
import { readServiceArgs, runServiceLifecycle } from '../lib/service-cli.mjs'

async function webHealthy() {
  const health = await probe(`${webURL()}/healthz`)
  return health.ok && health.body?.service === 'clara-web'
}

async function webHealthPid() {
  const health = await probe(`${webURL()}/healthz`)
  if (!health.ok || health.body?.service !== 'clara-web') return undefined
  return typeof health.body.pid === 'number' ? health.body.pid : undefined
}

const webService = {
  name: 'web',
  label: 'web',
  title: 'Clara web',
  filter: '@clara/web',
  local: {
    entry: join(root, 'tools', 'cli', 'src', 'lib', 'local-web.mjs'),
    ready: () => existsSync(join(WEB_DIST, 'index.html')),
    missing: 'The web client is not built. Run `pnpm build` first.',
    buildError: 'error: the local web build failed.',
    patterns: ['local-web.mjs'],
    ports: () => [webPort()],
    discoverPid: webHealthPid,
    adoptPid: webHealthPid,
    healthy: webHealthy,
    running: webHealthy,
    onStarted: () => {
      console.log(`web: ${webURL()}/`)
      console.log(`  logs:  ${logPath('web')}`)
      console.log('Stop it with `clara stop web`.')
    },
  },
}

const ctx = readServiceArgs(process.argv.slice(2))

if (ctx.help) {
  printHelp()
  process.exit(0)
}

if (!(await runServiceLifecycle(webService, ctx))) {
  console.error(`Unknown web command: ${ctx.command}`)
  printHelp()
  process.exitCode = 2
}

function printHelp() {
  console.log(
    renderCommandHelp({
      summary: 'Manage the Clara web client',
      usage: [
        'start web [--build]',
        'stop web',
        'restart web [--build]',
        'status web [--json]',
        'logs web',
      ],
      options: [
        { flags: '--build', description: 'build before starting' },
        { flags: '--json', description: 'machine-readable status' },
      ],
      examples: ['clara start web', 'clara status web', 'clara logs web'],
    })
  )
}
