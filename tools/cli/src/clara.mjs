// The `clara` command tree.
//
// `main.mjs` dispatches from this tree, and the leaf scripts render their help
// from the same definitions so `clara <command> --help` and
// `clara help <command>` always agree. Keep examples consistent with the
// `clara` executable: never spell them as a package-manager script.

import { join } from 'node:path'
import { root, runNode } from './lib/router.mjs'

function lifecycle(command, args) {
  return runNode(join(root, 'tools/cli/src/commands/lifecycle.mjs'), [command, ...args])
}

function rebuild(args) {
  return runNode(join(root, 'tools/cli/src/commands/rebuild.mjs'), args)
}

const TARGETS = [
  { name: 'default', description: 'hub, web, and engine' },
  { name: 'hub', description: 'Clara hub' },
  { name: 'web', description: 'web client' },
  { name: 'engine', description: 'pipeline engine' },
  { name: 'lab', description: 'Clara Lab' },
  { name: 'docs', description: 'documentation site' },
]

const TARGETS_SECTION = { label: 'Targets', items: TARGETS }

const LAB_OPTIONS = [
  { flags: '--workspace <path>', description: 'lab: workspace path' },
  { flags: '--target <ref>', description: 'lab: package target' },
  { flags: '--config <path>', description: 'lab: package config' },
]

const DOCS_OPTIONS = [{ flags: '--preview', description: 'docs: serve the production build' }]

const SITE_OPTIONS = [
  { flags: '--port <n>', description: 'lab or docs: listen port' },
  { flags: '--no-open', description: 'lab or docs: do not open a browser' },
]

const START_OPTIONS = [
  { flags: '--build', description: 'build before starting' },
  { flags: '--open', description: 'open the hub panel after starting' },
  { flags: '--foreground', description: 'engine: run in the foreground' },
  ...LAB_OPTIONS,
  ...SITE_OPTIONS,
  ...DOCS_OPTIONS,
]

const commands = [
  {
    name: 'start',
    group: 'Lifecycle',
    summary: 'Start the core stack or a host-side target',
    usage: '<target> [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    options: START_OPTIONS,
    examples: [
      'clara start',
      'clara start hub --build',
      'clara start hub --open',
      'clara start lab',
      'clara start docs --build',
    ],
    run: (args) => lifecycle('start', args),
  },
  {
    name: 'stop',
    group: 'Lifecycle',
    summary: 'Stop the core stack or a host-side target',
    usage: '<target> [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    examples: ['clara stop', 'clara stop hub'],
    run: (args) => lifecycle('stop', args),
  },
  {
    name: 'restart',
    group: 'Lifecycle',
    summary: 'Restart the core stack or a host-side target',
    usage: '<target> [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    options: [
      { flags: '--build', description: 'build before starting' },
      { flags: '--open', description: 'open the hub panel after starting' },
      ...LAB_OPTIONS,
      ...SITE_OPTIONS,
      ...DOCS_OPTIONS,
    ],
    examples: ['clara restart', 'clara restart --build'],
    run: (args) => lifecycle('restart', args),
  },
  {
    name: 'status',
    group: 'Lifecycle',
    summary: 'Inspect the core stack, Lab, or docs',
    usage: '[target] [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    options: [
      { flags: '--json', description: 'machine-readable output' },
      { flags: '--open', description: 'open the hub panel' },
      { flags: '--check', description: 'lab or docs: run the check' },
      { flags: '--typecheck', description: 'docs: typecheck the site' },
    ],
    examples: [
      'clara status',
      'clara status hub --json',
      'clara status hub --open',
      'clara status docs --check',
    ],
    run: (args) => lifecycle('status', args),
  },
  {
    name: 'logs',
    group: 'Lifecycle',
    summary: 'Follow core service, Lab, or docs logs',
    usage: '<target> [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    options: [
      { flags: '--lines <n>', description: 'tail length (default 80)' },
      { flags: '--no-follow', description: 'print the tail and exit' },
    ],
    examples: ['clara logs hub', 'clara logs lab'],
    run: (args) => lifecycle('logs', args),
  },
  {
    name: 'pair',
    group: 'Setup',
    summary: 'Print a browser pairing code',
    usage: '[hub] [--no-relay] [--no-qr] [--no-panel] [--revoke-all] [--revoke <id>]',
    passthroughHelp: true,
    options: [
      { flags: '--no-relay', description: 'print a local-only code' },
      { flags: '--no-qr', description: 'skip the QR code' },
      { flags: '--no-panel', description: 'do not print the panel link' },
      { flags: '--revoke-all', description: 'revoke every paired device' },
      { flags: '--revoke <id>', description: 'revoke one paired device' },
    ],
    examples: ['clara pair', 'clara pair hub --no-relay'],
    run: (args) => lifecycle('pair', args),
  },
  {
    name: 'mcp',
    group: 'Setup',
    summary: 'Install or remove the OpenCode MCP bridge from this checkout',
    usage: 'install|uninstall|status|config [--api] [--no-start]',
    options: [
      { flags: '--api', description: 'also register the read-only hub API MCP' },
      { flags: '--no-start', description: 'do not start the engine' },
    ],
    examples: ['clara mcp install', 'clara mcp install --api', 'clara mcp status'],
    run: (args) => runNode(join(root, 'tools/cli/src/commands/install-mcp.mjs'), args),
  },
  {
    name: 'rebuild',
    group: 'Maintenance',
    summary: 'Snapshot, rebuild, restart, and verify the captured services',
    passthroughHelp: true,
    commands: [
      {
        name: 'status',
        summary: 'Capture the services, deployment modes, and shell state',
      },
      { name: 'build', summary: 'Install dependencies and build the checkout' },
      { name: 'adapters', summary: 'Reinstall adapters, the agent, and the MCP entry' },
      { name: 'restart', summary: 'Restart the captured services from the snapshot' },
      { name: 'health', summary: 'Probe the captured services' },
      { name: 'inspect', summary: 'Read the snapshot, journal, health, and logs' },
      { name: 'recover', summary: 'Restart only expected services that fail health' },
    ],
    options: [
      { flags: '--root <path>', description: 'build checkout (default: the primary worktree)' },
      {
        flags: '--state <path>',
        description: 'snapshot path (default: <data dir>/rebuild/setup.json)',
      },
      { flags: '--json', description: 'print machine-readable JSON on stdout' },
      { flags: '--dry-run', description: 'show the restart plan without changing services' },
      {
        flags: '--manage-external',
        description: 'restart an engine managed outside this checkout',
      },
      { flags: '--force', description: 'ignore a stale snapshot or completed restart journal' },
      {
        flags: '--skip <service>',
        description: 'skip web, lab, hub, or engine (repeatable)',
      },
      { flags: '--mcp / --no-mcp', description: 'install or skip the MCP entry' },
      { flags: '--lines <n>', description: 'inspect: log tail length' },
    ],
    examples: [
      'clara rebuild',
      'clara rebuild status --json',
      'clara rebuild restart --dry-run',
      'clara rebuild health --json',
      'clara rebuild recover --json',
    ],
    run: rebuild,
  },
]

export const clara = {
  name: 'clara',
  bin: 'clara',
  summary: 'Clara lifecycle and maintenance tools',
  examples: ['clara start', 'clara status', 'clara start lab', 'clara pair', 'clara rebuild'],
  commands,
}
