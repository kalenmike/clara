#!/usr/bin/env node
// Clara developer tools.
//
//   pnpm clara pair
//   pnpm clara control

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fail, main, root, runNode, runPnpm } from './lib/router.mjs'

function pair(args) {
  return runPnpm(['--filter', '@clara/server', 'exec', 'tsx', 'src/index.ts', 'pair', ...args])
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

function orchestration(args) {
  return runTypeScript(
    join(root, 'apps/orchestrator/src/index.ts'),
    join(root, 'apps/orchestrator/dist/index.js'),
    args,
    'The orchestration service'
  )
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
  return runNode(join(root, 'scripts/install-clara-adapter.mjs'), args)
}

const clara = {
  name: 'clara',
  summary: 'Clara developer tools',
  examples: [
    'pnpm clara pair --local',
    'pnpm clara control',
    'pnpm clara orchestration start',
    'pnpm clara lab',
    'pnpm clara mcp install',
  ],
  commands: [
    {
      name: 'pair',
      summary: 'Print a pairing code for a device',
      usage: '[--local] [--rotate] [--no-qr] [--no-panel]',
      options: [
        { flags: '--local', description: 'Force a local-only pairing code' },
        { flags: '--rotate', description: 'Rotate the pairing key and clear push subscriptions' },
        { flags: '--no-qr', description: 'Print the code without the QR block' },
        { flags: '--no-panel', description: 'Do not start the panel listener while pairing' },
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
      name: 'pass',
      summary: 'Print the local OpenCode server password',
      run: pass,
    },
    {
      name: 'orchestration',
      summary: 'Run the local orchestration service',
      usage: '<serve|start [--docker] [--build]|stop [--docker]|status|analyze|token>',
      passthroughHelp: true,
      examples: [
        'pnpm clara orchestration start',
        'pnpm clara orchestration start --docker',
        'pnpm clara orchestration status',
        'pnpm clara orchestration analyze',
        'pnpm clara orchestration stop --docker',
        'pnpm clara orchestration serve',
      ],
      run: orchestration,
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
      summary: 'Install the OpenCode strict enforcement adapter',
      usage: '<install|uninstall|status> [opencode]',
      passthroughHelp: true,
      examples: ['pnpm clara adapter install opencode', 'pnpm clara adapter status'],
      run: adapter,
    },
  ],
}

await main(clara)
