#!/usr/bin/env node
// Clara developer tools.
//
//   pnpm clara pair
//   pnpm clara server panel

import { existsSync } from 'node:fs'
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
    'pnpm clara start --local --build',
    'pnpm clara server setup-token --host',
    'pnpm clara server panel',
    'pnpm clara pair --local',
    'pnpm clara adapter install --opencode',
    'pnpm clara lab',
  ],
  commands: [
    {
      name: 'start',
      group: 'Stack',
      summary: 'Start the stack (Docker by default, or --local)',
      usage: '[--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build]',
      passthroughHelp: true,
      examples: [
        'pnpm clara start',
        'pnpm clara start --local',
        'pnpm clara start --local --build',
        'pnpm clara start --docker --build',
        'pnpm clara start --no-web',
      ],
      run: (args) => stack('start', args),
    },
    {
      name: 'stop',
      group: 'Stack',
      summary: 'Stop the stack',
      usage: '[--local|--docker] [--no-server] [--no-web] [--no-orchestrator]',
      passthroughHelp: true,
      examples: ['pnpm clara stop', 'pnpm clara stop --local', 'pnpm clara stop --no-web'],
      run: (args) => stack('stop', args),
    },
    {
      name: 'restart',
      group: 'Stack',
      summary: 'Restart the stack',
      usage: '[--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build]',
      passthroughHelp: true,
      examples: ['pnpm clara restart', 'pnpm clara restart --local --build'],
      run: (args) => stack('restart', args),
    },
    {
      name: 'status',
      group: 'Stack',
      summary: 'Probe the selected services; use --json for machines',
      usage: '[--no-server] [--no-web] [--no-orchestrator] [--json]',
      examples: ['pnpm clara status', 'pnpm clara status --json', 'pnpm clara status --no-web'],
      run: (args) => stack('status', args),
    },
    {
      name: 'logs',
      group: 'Stack',
      summary: 'Follow one service log',
      usage: '<server|web|orchestrator> [--local|--docker]',
      passthroughHelp: true,
      examples: ['pnpm clara logs server', 'pnpm clara logs orchestrator --local'],
      run: (args) => stack('logs', args),
    },
    {
      name: 'backup',
      group: 'Stack',
      summary: 'Archive the Docker state volumes',
      usage: '[--output <path>]',
      passthroughHelp: true,
      examples: ['pnpm clara backup', 'pnpm clara backup --output ~/clara-backup.tar.gz'],
      run: (args) => stack('backup', args),
    },
    {
      name: 'restore',
      group: 'Stack',
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
      group: 'Services',
      summary: 'Start, stop, inspect, open the panel, or pair the home agent',
      usage:
        '<start|stop|restart|status [--json]|panel|setup-token|admin|pair|logs> [--local|--docker] [--host] [--build]',
      passthroughHelp: true,
      examples: [
        'pnpm clara server start',
        'pnpm clara server start --local --build',
        'pnpm clara server stop --local',
        'pnpm clara server status --json',
        'pnpm clara server panel',
        'pnpm clara server setup-token --docker',
        'pnpm clara server admin reset --docker',
        'pnpm clara server pair',
        'pnpm clara server logs --local',
      ],
      run: server,
    },
    {
      name: 'web',
      group: 'Services',
      summary: 'Start, stop, inspect, or follow the web client',
      usage: '<start|stop|restart|status [--json]|logs> [--local|--docker] [--build]',
      passthroughHelp: true,
      examples: [
        'pnpm clara web start',
        'pnpm clara web start --local --build',
        'pnpm clara web stop --local',
        'pnpm clara web status --json',
        'pnpm clara web logs --local',
      ],
      run: web,
    },
    {
      name: 'orchestrator',
      group: 'Services',
      summary: 'Start, stop, inspect, or run the orchestration service',
      usage:
        '<serve|start [--local|--docker] [--build]|stop [--local|--docker]|restart [--local|--docker] [--build]|status [--json]|logs [--local|--docker]|analyze|inspect|token>',
      passthroughHelp: true,
      examples: [
        'pnpm clara orchestrator start',
        'pnpm clara orchestrator start --local',
        'pnpm clara orchestrator start --local --build',
        'pnpm clara orchestrator restart',
        'pnpm clara orchestrator status --json',
        'pnpm clara orchestrator logs --local',
        'pnpm clara orchestrator analyze',
        'pnpm clara orchestrator inspect --json',
        'pnpm clara orchestrator serve',
      ],
      run: orchestrator,
    },
    {
      name: 'adapter',
      group: 'Services',
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
      name: 'mcp',
      group: 'Services',
      summary: 'Install or inspect the low-level MCP bridge',
      usage: '<install|uninstall|config|status>',
      passthroughHelp: true,
      examples: ['pnpm clara mcp install', 'pnpm clara mcp config', 'pnpm clara mcp status'],
      run: mcp,
    },
    {
      name: 'runner',
      group: 'Services',
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
      name: 'pair',
      group: 'Setup',
      summary: 'Print a pairing code for a device',
      usage: '[--local] [--no-qr] [--no-panel] [--revoke-all] [--revoke <id>] [--docker|--host]',
      options: [
        { flags: '--local', description: 'Force a local-only pairing code' },
        { flags: '--revoke-all', description: 'Revoke every device and clear push subscriptions' },
        { flags: '--revoke <id>', description: 'Revoke one device by id' },
        { flags: '--no-qr', description: 'Print the code without the QR block' },
        { flags: '--no-panel', description: 'Do not start the panel listener while pairing' },
        { flags: '--docker', description: 'Read the code from the server container' },
        { flags: '--host', description: 'Read the code from a local install' },
      ],
      run: pair,
    },
    {
      name: 'lab',
      group: 'Tools',
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
      name: 'rebuild',
      group: 'Tools',
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
