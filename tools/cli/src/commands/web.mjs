#!/usr/bin/env node
// Docker and local controls for the Clara web client.
//
//   clara start web [--local|--docker] [--build]
//   clara stop web [--local|--docker]
//   clara restart web [--local|--docker] [--build]
//   clara status web
//   clara logs web [--local|--docker]

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logPath } from '../lib/local-runtime.mjs'
import { WEB_DIST } from '../lib/local-web.mjs'
import { renderCommandHelp, root } from '../lib/router.mjs'
import { probe } from '../lib/server-control.mjs'
import { readServiceArgs, runServiceLifecycle } from '../lib/service-cli.mjs'
import { compose, waitForWeb, webPort, webURL } from '../lib/web-control.mjs'

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
      console.log('Stop it with `clara stop web --local`.')
    },
  },
  docker: {
    compose,
    service: 'web',
    healthy: () => waitForWeb(90_000),
    unhealthy: () => `The web container did not become healthy at ${webURL()}/healthz`,
    onStarted: () => {
      console.log(`web: ${webURL()}/`)
      console.log('Run `clara pair` for the hub pairing mode, or add --local')
      console.log('to force a local code.')
      console.log('An HTTPS page cannot open a ws:// socket; remote clients need the relay.')
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
        'start web [--docker|--local] [--build]',
        'stop web [--docker|--local]',
        'restart web [--docker|--local] [--build]',
        'status web [--json]',
        'logs web [--docker|--local] [--lines <n>] [--no-follow]',
      ],
      options: [
        { flags: '--docker', description: 'use the clara-web container (default)' },
        { flags: '--local', description: 'serve the built SPA from apps/web/dist' },
        { flags: '--build', description: 'build before starting' },
        { flags: '--json', description: 'machine-readable status' },
        { flags: '--lines <n>', description: 'tail length (default 80)' },
        { flags: '--no-follow', description: 'print the tail and exit' },
      ],
      examples: ['clara start web --local', 'clara status web', 'clara logs web --local'],
    })
  )
}
