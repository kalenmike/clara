#!/usr/bin/env node
import { adapterVersion, runAdapterCli, type AdapterDefinition } from '@clara/adapter-runtime'
import { openCodePaths, type OpenCodeConfig } from './config.ts'
import { createAdapterApp } from './handler.ts'
import {
  installOpenCodeCommand,
  resolveOpenCodeConfig,
  uninstallOpenCodeCommand,
} from './install.ts'
import { OpenCodeGateway } from './opencode.ts'
import { verifyOpenCode } from './verify.ts'

const ADAPTER_NAME = 'opencode'
const ADAPTER_VERSION = adapterVersion('0.1.0')

const CAPABILITIES = {
  projects: { list: true, update: true, archive: true, unarchive: true, delete: true },
  sessions: {
    list: true,
    create: true,
    update: true,
    delete: true,
    fork: true,
    move: true,
    view: true,
    prompt: true,
    synthetic: true,
    command: true,
    interrupt: true,
    compact: true,
    agent: true,
    model: true,
    context: true,
  },
  messages: true,
  forms: true,
  inbox: true,
  permissions: true,
  catalog: {
    agents: true,
    models: true,
    providers: true,
    commands: true,
    skills: true,
    references: true,
  },
  files: true,
  vcs: true,
  worktrees: true,
  git: true,
  events: true,
  maintenance: { update: true },
  host: { metrics: true },
}

type Harness = { opencode: OpenCodeConfig }

const HELP = `Clara OpenCode adapter

Usage:
  clara-adapter-opencode install [--pair <code>] [options]
  clara-adapter-opencode pair [--pair <code>] [--opencode-url <url>]
  clara-adapter-opencode serve
  clara-adapter-opencode start|stop|logs [--lines <n>]
  clara-adapter-opencode status
  clara-adapter-opencode runner <status|start|stop> [--workspace <path>]
  clara-adapter-opencode upgrade [--check] [--json]
  clara-adapter-opencode clara <command...> [options]
  clara-adapter-opencode verify [--directory <path>] [--write] [--json]
  clara-adapter-opencode uninstall [--purge]
  clara-adapter-opencode config-path

Install options:
  --pair <code>            Pair the adapter with the hub
  --reuse-pairing          Reinstall with the saved pairing instead of enrolling
  --opencode-url <url>     OpenCode URL
  --opencode-username <u>  OpenCode username (default opencode)
  --opencode-password <p>  OpenCode password
  --mcp                    Register the MCP bridge in OpenCode
  --no-binding             Skip the OpenCode plugin, agent, and MCP config
  --no-service             Write config without installing a user service
  --force                  Replace files this installer did not generate
  --dry-run                Print the plan without writing anything

The clara command runs the real Clara CLI. When it is missing, it downloads
the signed release into the standard version store; the adapter never bundles
the Clara services.

The adapter connects out to the hub over the same WebSocket and E2EE session
as the browser. It never listens on an inbound port.`

function gateway(config: Harness): OpenCodeGateway {
  return new OpenCodeGateway({
    url: config.opencode.url,
    username: config.opencode.username,
    ...(config.opencode.password ? { password: config.opencode.password } : {}),
  })
}

function definition(): AdapterDefinition<Harness> {
  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,
    label: 'OpenCode',
    capabilities: CAPABILITIES,
    paths: openCodePaths(),
    probe: (config, timeoutMs) => gateway(config).probe(timeoutMs),
    createApp: ({ config, info }) =>
      createAdapterApp({
        opencode: gateway(config),
        info,
      }),
    describe: (config) => ({ url: config.opencode.url, label: 'OpenCode' }),
    resolveHarness: async (args) => ({ opencode: await resolveOpenCodeConfig(args) }),
    install: async (args) => {
      if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        return
      }
      await installOpenCodeCommand(args)
    },
    uninstall: async (args) => {
      if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        return
      }
      uninstallOpenCodeCommand(args)
    },
    verify: (config, options) => verifyOpenCode(config, options),
    help: HELP,
  }
}

runAdapterCli(definition(), process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
