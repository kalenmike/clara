#!/usr/bin/env node
import { join } from 'node:path'
import { runAdapterCli, type AdapterDefinition } from '@clara/adapter-runtime'
import { CLAUDE_CAPABILITIES } from './capabilities.ts'
import { claudePaths, type ClaudeConfig } from './config.ts'
import { EventBus } from './events.ts'
import { createAdapterApp } from './handler.ts'
import { installClaudeCommand, resolveClaudeConfig, uninstallClaudeCommand } from './install.ts'
import { AgentSdkGateway } from './sdk.ts'
import { SessionService } from './sessions.ts'
import { SessionStore } from './store.ts'

const ADAPTER_NAME = 'claude'
const ADAPTER_VERSION = '0.1.0'

type Harness = { claude: ClaudeConfig }

let cachedGateway: { key: string; value: AgentSdkGateway } | undefined
let cachedEvents: EventBus | undefined
let cachedSessions: { key: string; value: SessionService } | undefined

function gateway(config: Harness): AgentSdkGateway {
  const key = JSON.stringify(config.claude)
  if (!cachedGateway || cachedGateway.key !== key) {
    cachedGateway = { key, value: new AgentSdkGateway(config.claude) }
  }
  return cachedGateway.value
}

function events(): EventBus {
  cachedEvents ??= new EventBus()
  return cachedEvents
}

function sessions(config: Harness): SessionService {
  const gatewayInstance = gateway(config)
  const key = JSON.stringify(config.claude)
  if (!cachedSessions || cachedSessions.key !== key) {
    cachedSessions = {
      key,
      value: new SessionService(
        gatewayInstance,
        new SessionStore(join(claudePaths().dataDir, 'catalog.json')),
        ADAPTER_VERSION,
        (event) => events().publish(event)
      ),
    }
  }
  return cachedSessions.value
}

const HELP = `Clara Claude Code adapter

Usage:
  clara-adapter-claude install [--pair <code>] [options]
  clara-adapter-claude pair [--pair <code>] [options]
  clara-adapter-claude serve
  clara-adapter-claude start|stop|logs [--lines <n>]
  clara-adapter-claude status
  clara-adapter-claude uninstall [--purge]
  clara-adapter-claude config-path

Install options:
  --pair <code>                  Pair the adapter with the hub
  --claude-path <path>           Use a system Claude Code binary
  --model <model>                Default model for new sessions
  --agent <agent>                Default agent for new sessions
  --permission-mode <mode>       default, acceptEdits, plan, bypassPermissions, dontAsk, auto
  --max-turns <n>                Maximum agent turns per prompt
  --max-budget <usd>             Maximum spend per prompt
  --concurrency <n>              Concurrent active sessions (default 2)
  --additional-directory <path>  Extra directory Claude may access (repeatable)
  --skip-auth-check              Do not warn when the machine is signed out
  --no-service                   Write config without installing a user service
  --dry-run                      Print the plan without writing anything

Authentication stays on this machine. The adapter uses the existing Claude Code
login, or ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN from its environment.

The adapter connects out to the hub over the same WebSocket and E2EE session
as the browser. It never listens on an inbound port.`

function definition(): AdapterDefinition<Harness> {
  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,
    label: 'Claude Code',
    capabilities: CLAUDE_CAPABILITIES,
    paths: claudePaths(),
    probe: (config, timeoutMs) => gateway(config).probe(timeoutMs),
    createApp: ({ config, info }) =>
      createAdapterApp({
        claude: gateway(config),
        sessions: sessions(config),
        info,
        events: events(),
      }),
    describe: (config) => ({
      url: config.claude.claudePath ?? 'Claude Code (bundled)',
      label: 'Claude Code',
    }),
    resolveHarness: async (args) => ({ claude: await resolveClaudeConfig(args) }),
    install: async (args) => {
      if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        return
      }
      await installClaudeCommand(args)
    },
    uninstall: async (args) => {
      if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        return
      }
      uninstallClaudeCommand(args)
    },
    help: HELP,
  }
}

runAdapterCli(definition(), process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
