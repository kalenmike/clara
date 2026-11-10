#!/usr/bin/env node
// Clara developer tools.
//
//   pnpm clara pair
//   pnpm clara control

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fail, main, root, runNode, runPnpm } from './lib/router.mjs'
import { detectServerTarget } from './lib/server-control.mjs'

async function pair(args) {
  const result = await detectServerTarget({
    docker: args.includes('--docker'),
    local: args.includes('--host'),
  })
  if (result.target === 'ambiguous') {
    console.error(`Cannot choose where to read the pairing code: ${result.reason}.`)
    console.error('Pass --docker for the clara-server container, or --host for a local install.')
    process.exitCode = 1
    return
  }
  const forwarded = args.filter((arg) => arg !== '--docker' && arg !== '--host')
  if (result.target === 'container') {
    return runNode(join(root, 'scripts/server.mjs'), ['pair', '--docker', ...forwarded])
  }
  return runPnpm(['--filter', '@clara/server', 'exec', 'tsx', 'src/index.ts', 'pair', ...forwarded])
}

function server(args) {
  return runNode(join(root, 'scripts/server.mjs'), args)
}

function web(args) {
  return runNode(join(root, 'scripts/web.mjs'), args)
}

function serve(args) {
  const entry = join(root, 'apps/server/dist/index.js')
  if (!existsSync(entry)) fail('The home agent is not built. Run `pnpm build` first.')
  return runNode(entry, args)
}

function control(args) {
  return runNode(join(root, 'scripts/control.mjs'), args)
}

function pass() {
  const stateHome = process.env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
  const serviceFile = join(stateHome, 'opencode', 'service.json')
  if (!existsSync(serviceFile)) {
    fail(`OpenCode service file not found: ${serviceFile}`)
  }

  let password
  try {
    const service = JSON.parse(readFileSync(serviceFile, 'utf8'))
    password = service.password
  } catch (error) {
    fail(`Could not read ${serviceFile}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof password !== 'string' || password.length === 0) {
    fail(`No password in ${serviceFile}`)
  }
  console.log(password)
}

// Developer commands prefer their TypeScript source. A stale apps/*/dist build
// from before a merge would otherwise hide new flags.
function runTypeScript(source, built, args, label) {
  if (existsSync(source)) {
    return runNode(source, args, {
      nodeArgs: ['--experimental-strip-types', '--no-warnings'],
    })
  }
  if (existsSync(built)) return runNode(built, args)
  fail(`${label} is not built and its source is missing. Run \`pnpm build\` first.`)
}

function orchestrator(args) {
  return runNode(join(root, 'scripts/orchestrator.mjs'), args)
}

function stack(command, args) {
  return runNode(join(root, 'scripts/stack.mjs'), [command, ...args])
}

function lab(args) {
  return runTypeScript(
    join(root, 'apps/lab/server/index.ts'),
    join(root, 'apps/lab/dist/server/index.js'),
    args,
    'Clara Lab'
  )
}

function mcp(args) {
  return runNode(join(root, 'scripts/install-clara-mcp.mjs'), args)
}

function adapter(args) {
  return runTypeScript(
    join(root, 'packages/adapter/src/cli.ts'),
    join(root, 'packages/adapter/dist/cli.js'),
    args,
    'The Clara adapter installer'
  )
}

function rebuild(args) {
  return runNode(join(root, 'scripts/rebuild.mjs'), args)
}

function runner(args) {
  return runTypeScript(
    join(root, 'packages/runner/src/cli.ts'),
    join(root, 'packages/runner/dist/cli.js'),
    args,
    'The Clara runner'
  )
}

const clara = {
  name: 'clara',
  summary: 'Clara developer tools',
  examples: [
    'pnpm clara start',
    'pnpm clara pair --local',
    'pnpm clara control',
    'pnpm clara orchestrator start',
    'pnpm clara lab',
    'pnpm clara mcp install',
  ],
  commands: [
    {
      name: 'pair',
      summary: 'Print a pairing code for a device',
      usage: '[--local] [--rotate] [--no-qr] [--no-panel] [--docker|--host]',
      options: [
        { flags: '--local', description: 'Force a local-only pairing code' },
        { flags: '--rotate', description: 'Rotate the pairing key and clear push subscriptions' },
        { flags: '--no-qr', description: 'Print the code without the QR block' },
        { flags: '--no-panel', description: 'Do not start the panel listener while pairing' },
        { flags: '--docker', description: 'Read the code from the server container' },
        { flags: '--host', description: 'Read the code from a local install' },
      ],
      run: pair,
    },
    {
      name: 'control',
      summary: 'Serve the built panel and open it in a browser',
      options: [
        { flags: 'CLARA_PANEL_PORT', description: 'Panel port (default 8790)' },
        { flags: 'CLARA_PANEL_DISABLED', description: 'Set to 1 to refuse to start the panel' },
      ],
      run: control,
    },
    {
      name: 'serve',
      summary: 'Run the built home agent',
      usage: '[--rotate] [--no-panel]',
      options: [
        { flags: '--rotate', description: 'Rotate the pairing key and clear push subscriptions' },
        { flags: '--no-panel', description: 'Do not start the panel listener' },
      ],
      run: serve,
    },
    {
      name: 'start',
      summary: 'Start the Docker stack (orchestrator, server, and web)',
      usage: '[--no-server] [--no-web] [--no-orchestrator] [--build]',
      passthroughHelp: true,
      examples: [
        'pnpm clara start',
        'pnpm clara start --build',
        'pnpm clara start --no-web',
        'pnpm clara start --no-server --no-web',
      ],
      run: (args) => stack('start', args),
    },
    {
      name: 'stop',
      summary: 'Stop the Docker stack',
      usage: '[--no-server] [--no-web] [--no-orchestrator]',
      passthroughHelp: true,
      examples: ['pnpm clara stop', 'pnpm clara stop --no-web'],
      run: (args) => stack('stop', args),
    },
    {
      name: 'restart',
      summary: 'Restart the Docker stack',
      usage: '[--no-server] [--no-web] [--no-orchestrator] [--build]',
      passthroughHelp: true,
      examples: ['pnpm clara restart', 'pnpm clara restart --build'],
      run: (args) => stack('restart', args),
    },
    {
      name: 'status',
      summary: 'Probe the selected services; use --json for machines',
      usage: '[--no-server] [--no-web] [--no-orchestrator] [--json]',
      examples: ['pnpm clara status', 'pnpm clara status --json', 'pnpm clara status --no-web'],
      run: (args) => stack('status', args),
    },
    {
      name: 'logs',
      summary: 'Follow one stack container log',
      usage: '<server|web|orchestrator>',
      passthroughHelp: true,
      examples: ['pnpm clara logs server', 'pnpm clara logs orchestrator'],
      run: (args) => stack('logs', args),
    },
    {
      name: 'backup',
      summary: 'Archive the Docker state volumes',
      usage: '[--output <path>]',
      passthroughHelp: true,
      examples: ['pnpm clara backup', 'pnpm clara backup --output ~/clara-backup.tar.gz'],
      run: (args) => stack('backup', args),
    },
    {
      name: 'restore',
      summary: 'Replace the Docker state volumes from a backup',
      usage: '<archive> [--force]',
      passthroughHelp: true,
      examples: [
        'pnpm clara restore clara-backup.tar.gz',
        'pnpm clara restore clara-backup.tar.gz --force',
      ],
      run: (args) => stack('restore', args),
    },
    {
      name: 'server',
      summary: 'Start, stop, inspect, or pair the home agent container',
      usage: '<start|stop|status [--json]|setup-token|admin|pair|logs> [--docker|--host] [--build]',
      passthroughHelp: true,
      examples: [
        'pnpm clara server start --docker',
        'pnpm clara server status',
        'pnpm clara server status --json',
        'pnpm clara server setup-token',
        'pnpm clara server admin reset',
        'pnpm clara server pair',
        'pnpm clara server logs --docker',
      ],
      run: server,
    },
    {
      name: 'web',
      summary: 'Start, stop, inspect, or follow the web client container',
      usage: '<start|stop|status [--json]|logs> [--docker] [--build]',
      passthroughHelp: true,
      examples: [
        'pnpm clara web start --docker --build',
        'pnpm clara web status',
        'pnpm clara web status --json',
        'pnpm clara web logs --docker',
        'pnpm clara web stop --docker',
      ],
      run: web,
    },
    {
      name: 'pass',
      summary: 'Print the local OpenCode server password',
      run: pass,
    },
    {
      name: 'orchestrator',
      summary: 'Run the local orchestration service',
      usage:
        '<serve|start [--docker] [--build]|stop [--docker]|status [--json]|analyze|inspect|token>',
      passthroughHelp: true,
      examples: [
        'pnpm clara orchestrator start',
        'pnpm clara orchestrator start --docker',
        'pnpm clara orchestrator status',
        'pnpm clara orchestrator status --json',
        'pnpm clara orchestrator analyze',
        'pnpm clara orchestrator inspect --json',
        'pnpm clara orchestrator stop --docker',
        'pnpm clara orchestrator serve',
      ],
      run: orchestrator,
    },
    {
      name: 'lab',
      summary: 'Open Clara Lab to preview pipelines and probe the agent',
      usage: '[serve|check] [--workspace <path>] [--target <ref>] [--json]',
      passthroughHelp: true,
      examples: [
        'pnpm clara lab',
        'pnpm clara lab check --workspace . --target std:software/feature',
        'pnpm clara lab check --json',
      ],
      run: lab,
    },
    {
      name: 'mcp',
      summary: 'Install or inspect the Clara MCP bridge',
      usage: '<install|uninstall|config|status>',
      passthroughHelp: true,
      examples: ['pnpm clara mcp install', 'pnpm clara mcp config', 'pnpm clara mcp status'],
      run: mcp,
    },
    {
      name: 'adapter',
      summary: 'Install harness adapters, the MCP bridge, and the shared runner',
      usage: '<install|uninstall|status|runner> [--opencode] [--mcp] [--runner]',
      passthroughHelp: true,
      examples: [
        'pnpm clara adapter install --opencode',
        'pnpm clara adapter install --opencode --mcp',
        'pnpm clara adapter install --runner --mcp',
        'pnpm clara adapter status',
      ],
      run: adapter,
    },
    {
      name: 'runner',
      summary: 'Run script steps for a workspace',
      usage: '[--workspace <path>] [--label <name>] [--concurrency <n>] [--once]',
      passthroughHelp: true,
      examples: [
        'pnpm clara runner',
        'pnpm clara runner --workspace . --label build-host',
        'pnpm clara runner --once',
      ],
      run: runner,
    },
    {
      name: 'rebuild',
      summary: 'Rebuild Clara, reinstall adapters, restart services, and verify health',
      usage: '<status|build|adapters|restart|health|inspect|recover> [options]',
      passthroughHelp: true,
      examples: [
        'pnpm clara rebuild status --json',
        'pnpm clara rebuild build --json',
        'pnpm clara rebuild restart --dry-run',
        'pnpm clara rebuild health --json',
        'pnpm clara rebuild inspect --json',
        'pnpm clara rebuild recover --json',
      ],
      run: rebuild,
    },
  ],
}

await main(clara)
