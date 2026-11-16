#!/usr/bin/env node
import { join } from 'node:path'
import type { AdapterProbe } from '@clara/adapter-runtime'
import { adapterVersion, runAdapterCli, type AdapterDefinition } from '@clara/adapter-runtime'
import { PI_CAPABILITIES } from './capabilities.ts'
import {
  adapterConfigPath,
  adapterDataDir,
  piPaths,
  resolveAgentDir,
  resolveSessionDir,
  sessionRoots,
  type PiConfig,
} from './config.ts'
import { CatalogService } from './catalog.ts'
import { findPiBinary, probePi, resolvePiConfig } from './discover.ts'
import { EventBus } from './events.ts'
import { createAdapterApp } from './handler.ts'
import { installPiCommand, uninstallPiCommand } from './install.ts'
import { SessionIndex } from './pi/indexer.ts'
import { PromptMap } from './prompt-map.ts'
import { PiRuntime } from './runtime.ts'
import { SessionService } from './sessions.ts'
import { verifyPi } from './verify.ts'

const ADAPTER_NAME = 'pi'
const ADAPTER_VERSION = adapterVersion('0.1.0')

type Harness = { pi: PiConfig }

type Bundle = {
  sessions: SessionService
  runtime: PiRuntime
  catalog: CatalogService
  events: EventBus
  probe: () => Promise<AdapterProbe>
  close: () => Promise<void>
}

let cached: { key: string; value: Bundle } | undefined

const HELP = `Clara Pi adapter

Usage:
  clara-adapter-pi install [--pair <code>] [options]
  clara-adapter-pi pair [--pair <code>] [options]
  clara-adapter-pi serve
  clara-adapter-pi start|stop|logs [--lines <n>]
  clara-adapter-pi status
  clara-adapter-pi verify [--directory <path>] [--write] [--json]
  clara-adapter-pi uninstall [--purge]
  clara-adapter-pi config-path

Install options:
  --pair <code>                  Pair the adapter with the hub
  --reuse-pairing                Reinstall with the saved pairing instead of enrolling
  --pi-path <path>               Use a specific Pi binary
  --agent-dir <path>             Pi agent directory (default ~/.pi/agent)
  --session-dir <path>           Override Pi session storage
  --model <provider/id>          Default model for new sessions
  --thinking <level>             off, minimal, low, medium, high, xhigh, max
  --project-trust <mode>         inherit (default), always, or never
  --idle-timeout <minutes>       Keep idle Pi processes for this long (default 15)
  --max-processes <n>            Maximum live Pi processes (default 3)
  --no-service                   Write config without installing a user service
  --dry-run                      Print the plan without writing anything

The adapter runs the Pi installed on this machine and reads the same session
store, extensions, skills, prompt templates, and model configuration as the Pi
CLI. Authentication stays in Pi's own auth.json or environment.

The adapter connects out to the hub over the same WebSocket and E2EE session
as the browser. It never listens on an inbound port.`

function bundle(config: Harness): Bundle {
  const key = JSON.stringify(config.pi)
  if (cached && cached.key === key) return cached.value
  if (cached) void cached.value.close()
  const binary = findPiBinary(config.pi.piPath)
  if (!binary) {
    throw new Error(
      'Pi was not found. Install it from https://pi.dev, or reinstall the adapter with --pi-path <path>.'
    )
  }
  const events = new EventBus()
  const prompts = new PromptMap(join(adapterDataDir(), 'prompt-ids.json'))
  const index = new SessionIndex(() => sessionRoots(config.pi))
  const sessions = new SessionService(config.pi, index, prompts, ADAPTER_VERSION, (event) =>
    events.publish(event)
  )
  const runtime = new PiRuntime(config.pi, binary, sessions, events)
  const catalog = new CatalogService(config.pi, binary)
  const value: Bundle = {
    sessions,
    runtime,
    catalog,
    events,
    probe: () => probePi(config.pi),
    close: async () => {
      catalog.invalidate()
      await runtime.close()
    },
  }
  cached = { key, value }
  return value
}

function definition(): AdapterDefinition<Harness> {
  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,
    label: 'Pi',
    capabilities: PI_CAPABILITIES,
    paths: piPaths(),
    probe: (config, timeoutMs) => probePi(config.pi, timeoutMs),
    createApp: ({ config, info }) => {
      const value = bundle(config)
      return createAdapterApp({
        sessions: value.sessions,
        runtime: value.runtime,
        catalog: value.catalog,
        events: value.events,
        info,
        probe: () => value.probe(),
      })
    },
    describe: (config) => ({
      url: config.pi.piPath ?? 'Pi (not resolved)',
      label: 'Pi',
    }),
    resolveHarness: async (args) => ({ pi: await resolvePiConfig(args) }),
    install: async (args) => {
      if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        return
      }
      await installPiCommand(args)
    },
    uninstall: async (args) => {
      if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        return
      }
      uninstallPiCommand(args)
    },
    verify: (config, options) => verifyPi(config, options),
    statusLines: (config, probe) => [
      `pi:       ${config.pi.piPath ?? 'unresolved'}${probe.version ? ` (${probe.version})` : ''}`,
      `agent:    ${resolveAgentDir(config.pi)}`,
      `sessions: ${resolveSessionDir(config.pi)}`,
      `config:   ${adapterConfigPath()}`,
    ],
    help: HELP,
  }
}

process.once('exit', () => {
  void cached?.value.close()
})

runAdapterCli(definition(), process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
