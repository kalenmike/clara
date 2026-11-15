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
  { name: 'adapter', description: 'paired harness adapters' },
  { name: 'runner', description: 'shared script runner' },
  { name: 'lab', description: 'Clara Lab' },
  { name: 'docs', description: 'documentation site' },
]

const TARGETS_SECTION = { label: 'Targets', items: TARGETS }

const MODE_OPTIONS = [
  { flags: '--docker', description: 'use Docker (default)' },
  { flags: '--local', description: 'use host processes' },
]

const ADAPTER_PAIR_OPTIONS = [
  { flags: '--harness <name>', description: 'adapter: opencode, claude, pi, or all' },
  { flags: '--pair [<code>]', description: 'adapter: install and pair' },
  { flags: '--mcp', description: 'adapter: register the MCP bridge' },
  { flags: '--mcp-api', description: 'adapter: register the read-only hub API MCP' },
  { flags: '--no-runner', description: 'adapter: skip the shared runner' },
]

const RUNNER_OPTIONS = [
  { flags: '--workspace <path>', description: 'runner or lab: workspace path' },
  { flags: '--url <url>', description: 'runner: engine URL' },
  { flags: '--concurrency <n>', description: 'runner: concurrent scripts' },
  { flags: '--label <name>', description: 'runner: queue label (repeatable)' },
  { flags: '--no-service', description: 'runner: do not install a service' },
]

const LAB_OPTIONS = [
  { flags: '--target <ref>', description: 'lab: package target' },
  { flags: '--config <path>', description: 'lab: package config' },
]

const DOCS_OPTIONS = [{ flags: '--preview', description: 'docs: serve the production build' }]

const SITE_OPTIONS = [
  { flags: '--port <n>', description: 'lab or docs: listen port' },
  { flags: '--no-open', description: 'lab or docs: do not open a browser' },
]

const START_OPTIONS = [
  ...MODE_OPTIONS,
  { flags: '--build', description: 'build before starting' },
  { flags: '--open', description: 'open the hub panel after starting' },
  { flags: '--foreground', description: 'engine or runner: run in the foreground' },
  ...ADAPTER_PAIR_OPTIONS,
  ...RUNNER_OPTIONS,
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
      'clara start hub --local --build',
      'clara start hub --open',
      'clara start adapter --harness opencode --pair',
      'clara start runner',
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
    options: [
      ...MODE_OPTIONS,
      { flags: '--harness <name>', description: 'adapter: limit to one harness (repeatable)' },
      { flags: '--mcp', description: 'adapter: remove the MCP bridge' },
      { flags: '--mcp-api', description: 'adapter: remove the read-only hub API MCP' },
      { flags: '--purge', description: 'adapter or runner: remove the install' },
    ],
    examples: [
      'clara stop',
      'clara stop hub --local',
      'clara stop adapter',
      'clara stop adapter --purge',
    ],
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
      ...MODE_OPTIONS,
      { flags: '--build', description: 'build before starting' },
      { flags: '--open', description: 'open the hub panel after starting' },
      ...ADAPTER_PAIR_OPTIONS,
      ...RUNNER_OPTIONS,
      ...LAB_OPTIONS,
      ...SITE_OPTIONS,
      ...DOCS_OPTIONS,
    ],
    examples: [
      'clara restart',
      'clara restart --build',
      'clara restart adapter --harness opencode',
    ],
    run: (args) => lifecycle('restart', args),
  },
  {
    name: 'status',
    group: 'Lifecycle',
    summary: 'Inspect the core stack, adapters, runner, Lab, or docs',
    usage: '[target] [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    options: [
      { flags: '--json', description: 'machine-readable output' },
      { flags: '--open', description: 'open the hub panel' },
      { flags: '--harness <name>', description: 'adapter: limit to one harness (repeatable)' },
      { flags: '--verify', description: 'adapter: verify against the native store' },
      { flags: '--directory <path>', description: 'adapter: workspace for --verify' },
      { flags: '--write', description: 'adapter: create a scratch session during --verify' },
      { flags: '--check', description: 'lab or docs: run the check' },
      { flags: '--typecheck', description: 'docs: typecheck the site' },
    ],
    examples: [
      'clara status',
      'clara status hub --json',
      'clara status hub --open',
      'clara status adapter',
      'clara status adapter --verify',
      'clara status docs --check',
    ],
    run: (args) => lifecycle('status', args),
  },
  {
    name: 'logs',
    group: 'Lifecycle',
    summary: 'Follow core service, adapter, runner, Lab, or docs logs',
    usage: '<target> [options]',
    passthroughHelp: true,
    sections: [TARGETS_SECTION],
    options: [
      ...MODE_OPTIONS,
      { flags: '--harness <name>', description: 'adapter: limit to one harness (repeatable)' },
      { flags: '--lines <n>', description: 'tail length (default 80)' },
      { flags: '--no-follow', description: 'print the tail and exit' },
    ],
    examples: [
      'clara logs hub',
      'clara logs hub --local',
      'clara logs adapter --harness opencode',
      'clara logs runner',
    ],
    run: (args) => lifecycle('logs', args),
  },
  {
    name: 'backup',
    group: 'State',
    summary: 'Archive the selected Docker state volumes',
    usage: '[default|hub|engine] [options]',
    passthroughHelp: true,
    options: [
      {
        flags: '-o, --output <path>',
        description: 'archive path (default: a timestamped file in this directory)',
      },
    ],
    examples: ['clara backup', 'clara backup hub --output ~/clara-hub.tar.gz'],
    run: (args) => lifecycle('backup', args),
  },
  {
    name: 'restore',
    group: 'State',
    summary: 'Replace Docker state volumes from a backup',
    usage: '[default|hub|engine] <archive> [options]',
    passthroughHelp: true,
    options: [{ flags: '--force', description: 'replace existing volume contents' }],
    examples: ['clara restore clara-backup.tar.gz', 'clara restore hub backup.tar.gz --force'],
    run: (args) => lifecycle('restore', args),
  },
  {
    name: 'pair',
    group: 'Setup',
    summary: 'Print a browser or adapter pairing code',
    usage: [
      '[hub] [--no-relay] [--no-qr] [--no-panel] [--revoke-all] [--revoke <id>] [--docker|--local]',
      'adapter --harness <opencode|claude|pi> [--transport local|relay|docker] [--ws-url <url>] [--docker|--local]',
    ],
    passthroughHelp: true,
    options: [
      { flags: '--harness <name>', description: 'adapter: opencode, claude, or pi' },
      { flags: '--transport <mode>', description: 'adapter: local, relay, or docker' },
      { flags: '--ws-url <url>', description: 'adapter: override the WebSocket URL' },
      { flags: '--no-relay', description: 'hub: print a local-only code' },
      { flags: '--no-qr', description: 'hub: skip the QR code' },
      { flags: '--no-panel', description: 'hub: do not print the panel link' },
      { flags: '--revoke-all', description: 'hub: revoke every paired device' },
      { flags: '--revoke <id>', description: 'hub: revoke one paired device' },
      ...MODE_OPTIONS,
    ],
    examples: [
      'clara pair',
      'clara pair hub --no-relay',
      'clara pair adapter --harness opencode',
      'clara pair adapter --harness claude --transport relay',
    ],
    run: (args) => lifecycle('pair', args),
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
      { flags: '--local', description: 'manage local services only' },
      { flags: '--docker', description: 'manage container services only (default)' },
      { flags: '--all', description: 'manage local and container services together' },
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
  examples: [
    'clara start',
    'clara status adapter',
    'clara start adapter --harness opencode --pair',
    'clara pair adapter --harness claude',
    'clara rebuild',
  ],
  commands,
}
