#!/usr/bin/env node
// Clara lifecycle and maintenance tools.
//
//   pnpm clara start hub --local
//   pnpm clara status adapter
//   pnpm clara pair adapter --harness opencode

import { join } from 'node:path'
import { main, root, runNode } from './lib/router.mjs'

function lifecycle(command, args) {
  return runNode(join(root, 'tools/cli/src/commands/lifecycle.mjs'), [command, ...args])
}

function rebuild(args) {
  return runNode(join(root, 'tools/cli/src/commands/rebuild.mjs'), args)
}

const lifecycleCommands = [
  {
    name: 'start',
    group: 'Lifecycle',
    summary: 'Start the core stack or a host-side target',
    usage: '<default|hub|web|orchestrator|adapter|runner|lab|docs> [options]',
    passthroughHelp: true,
    examples: [
      'pnpm clara start',
      'pnpm clara start hub --local --build',
      'pnpm clara start adapter --harness opencode --pair',
      'pnpm clara start runner',
      'pnpm clara start lab',
      'pnpm clara start docs --build',
    ],
  },
  {
    name: 'stop',
    group: 'Lifecycle',
    summary: 'Stop the core stack or a host-side target',
    usage: '<default|hub|web|orchestrator|adapter|runner|lab|docs> [options]',
    passthroughHelp: true,
    examples: ['pnpm clara stop', 'pnpm clara stop hub --local', 'pnpm clara stop adapter'],
  },
  {
    name: 'restart',
    group: 'Lifecycle',
    summary: 'Restart the core stack or a host-side target',
    usage: '<default|hub|web|orchestrator|adapter|runner|lab|docs> [options]',
    passthroughHelp: true,
    examples: ['pnpm clara restart --build', 'pnpm clara restart adapter --harness opencode'],
  },
  {
    name: 'status',
    group: 'Lifecycle',
    summary: 'Inspect the core stack, adapters, runner, Lab, or docs',
    usage: '<default|hub|web|orchestrator|adapter|runner|lab|docs> [--json]',
    passthroughHelp: true,
    examples: [
      'pnpm clara status',
      'pnpm clara status hub --json',
      'pnpm clara status adapter',
      'pnpm clara status adapter --harness opencode',
    ],
  },
  {
    name: 'logs',
    group: 'Lifecycle',
    summary: 'Follow core service, adapter, runner, Lab, or docs logs',
    usage: '<default|hub|web|orchestrator|adapter|runner|lab|docs> [options]',
    passthroughHelp: true,
    examples: [
      'pnpm clara logs hub',
      'pnpm clara logs adapter',
      'pnpm clara logs adapter --harness opencode',
      'pnpm clara logs runner',
    ],
  },
  {
    name: 'backup',
    group: 'State',
    summary: 'Archive the selected Docker state volumes',
    usage: '[default|hub|orchestrator] [--output <path>]',
    passthroughHelp: true,
    examples: ['pnpm clara backup', 'pnpm clara backup hub --output ~/clara-hub.tar.gz'],
  },
  {
    name: 'restore',
    group: 'State',
    summary: 'Replace Docker state volumes from a backup',
    usage: '[default|hub|orchestrator] <archive> [--force]',
    passthroughHelp: true,
    examples: ['pnpm clara restore clara-backup.tar.gz', 'pnpm clara restore hub backup.tar.gz'],
  },
  {
    name: 'pair',
    group: 'Setup',
    summary: 'Print a browser or adapter pairing code',
    usage: '[hub|adapter] [options]',
    passthroughHelp: true,
    examples: [
      'pnpm clara pair',
      'pnpm clara pair hub --no-relay',
      'pnpm clara pair adapter --harness opencode',
    ],
  },
]

for (const command of lifecycleCommands) {
  command.run = (args) => lifecycle(command.name, args)
}

const clara = {
  name: 'clara',
  summary: 'Clara lifecycle and maintenance tools',
  examples: [
    'pnpm clara start',
    'pnpm clara status adapter',
    'pnpm clara start adapter --harness opencode --pair',
    'pnpm clara pair adapter --harness claude',
    'pnpm clara backup hub',
  ],
  commands: [
    ...lifecycleCommands,
    {
      name: 'rebuild',
      group: 'Maintenance',
      summary: 'Snapshot, rebuild, restart, and verify the captured services',
      usage: '<status|build|adapters|restart|health|inspect|recover> [options]',
      passthroughHelp: true,
      examples: [
        'pnpm clara rebuild',
        'pnpm clara rebuild status --json',
        'pnpm clara rebuild restart --dry-run',
        'pnpm clara rebuild health --json',
        'pnpm clara rebuild recover --json',
      ],
      run: rebuild,
    },
  ],
}

await main(clara)
