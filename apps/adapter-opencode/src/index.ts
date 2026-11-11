#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { HARNESS_PROTOCOL_VERSION } from '@clara/harness-protocol'
import { parseHarnessPairingInput, type HarnessPairingPayload } from '@clara/shared-types'
import {
  adapterConfigPath,
  adapterIdentityPath,
  loadIdentity,
  readConfig,
  writeConfig,
  type AdapterConfig,
} from './config.ts'
import { discoverOpenCode, type DiscoveryInput } from './discover.ts'
import { enrollAdapter } from './enroll.ts'
import { createAdapterApp } from './handler.ts'
import { OpenCodeClient } from './opencode.ts'
import { AdapterTransport } from './transport.ts'

const ADAPTER_NAME = 'opencode'
const ADAPTER_VERSION = '0.1.0'

const CAPABILITIES = {
  projects: { list: true, update: true },
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
}

async function main(argv: string[]): Promise<void> {
  const [command = 'serve', ...args] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === 'serve') {
    await serve(args)
    return
  }
  if (command === 'pair') {
    await pair(args)
    return
  }
  if (command === 'install') {
    await install(args)
    return
  }
  if (command === 'status') {
    await status()
    return
  }
  if (command === 'config-path') {
    console.log(adapterConfigPath())
    console.log(adapterIdentityPath())
    return
  }
  throw new Error(`unknown command: ${command}`)
}

async function serve(args: string[]): Promise<void> {
  const config = readConfig()
  if (!config) {
    throw new Error(
      `No adapter config at ${adapterConfigPath()}. Run: clara-adapter-opencode install --pair <code>`
    )
  }
  const openCode = new OpenCodeClient(
    config.opencode.url,
    config.opencode.password,
    config.opencode.username
  )
  const probe = await openCode.probe(3_000)
  const app = createAdapterApp({
    opencode: openCode,
    info: {
      adapter: { name: ADAPTER_NAME, version: ADAPTER_VERSION },
      harness: { kind: 'opencode', ...(probe.version ? { version: probe.version } : {}) },
      capabilities: CAPABILITIES,
    },
  })
  const transport = new AdapterTransport({
    wsUrl: argValue(args, '--ws-url') ?? config.wsUrl,
    clientToken: argValue(args, '--client-token') ?? config.clientToken,
    identity: { harnessId: config.harnessId, adapterId: config.adapterId, key: config.key },
    kind: 'opencode',
    label: config.label ?? 'OpenCode',
    info: {
      adapterVersion: ADAPTER_VERSION,
      protocolVersion: HARNESS_PROTOCOL_VERSION,
      ...(probe.version ? { harnessVersion: probe.version } : {}),
      capabilities: CAPABILITIES,
    },
    handler: async (request) => app.fetch(request),
    log: (message, detail) => {
      if (process.env.CLARA_ADAPTER_DEBUG === '1') console.error(message, detail ?? '')
    },
  })
  transport.start()
  console.log(
    `Clara OpenCode adapter ${ADAPTER_VERSION} connecting to ${config.wsUrl} as ${config.harnessId}`
  )
  const stop = () => {
    transport.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function pair(args: string[]): Promise<void> {
  const input = await pairingInput(args)
  const identity = loadIdentity()
  const discovery = await discoverOpenCode(discoveryInput(args))
  const openCode = discovery ?? (await promptOpenCode(args))
  const config: AdapterConfig = {
    ...identity,
    wsUrl: input.wsUrl,
    clientToken: input.clientToken,
    opencode: openCode,
    label: input.kind === 'opencode' ? 'OpenCode' : input.kind,
  }
  const enrolled = await enroll(identity, input, openCode)
  writeConfig(config)
  console.log(
    `Paired ${input.kind} adapter ${identity.harnessId} as connection ${enrolled.connectionId}` +
      (enrolled.reconnected ? ' (reconnected)' : '')
  )
  console.log(`Config: ${adapterConfigPath()}`)
  console.log('Start it with: clara-adapter-opencode serve')
}

async function install(args: string[]): Promise<void> {
  const pairCode = argValue(args, '--pair')
  if (!pairCode) {
    console.log('Install the OpenCode adapter config and pair it with the hub.')
  }
  await pair(args)
}

async function status(): Promise<void> {
  const config = readConfig()
  const identity = loadIdentity()
  console.log(`adapter:  ${ADAPTER_NAME} ${ADAPTER_VERSION}`)
  console.log(`harness:  ${identity.harnessId}`)
  console.log(`credential: ${identity.adapterId}`)
  if (!config) {
    console.log('config:   missing')
    return
  }
  console.log(`config:   ${adapterConfigPath()}`)
  console.log(`ws:       ${config.wsUrl}`)
  console.log(`opencode: ${config.opencode.url}`)
  const probe = await new OpenCodeClient(
    config.opencode.url,
    config.opencode.password,
    config.opencode.username
  ).probe(3_000)
  console.log(
    `reachable: ${probe.ok ? `yes${probe.version ? ` (${probe.version})` : ''}` : `no (${probe.code})`}`
  )
}

async function enroll(
  identity: { harnessId: string; adapterId: string; key: string },
  input: HarnessPairingPayload,
  openCode: { url: string; username: string; password?: string }
) {
  const probe = await new OpenCodeClient(openCode.url, openCode.password, openCode.username).probe(
    3_000
  )
  const result = await enrollAdapter({
    wsUrl: input.wsUrl,
    clientToken: input.clientToken,
    enrollId: input.enrollId,
    enrollToken: input.enrollToken,
    harnessId: identity.harnessId,
    kind: input.kind,
    label: input.kind === 'opencode' ? 'OpenCode' : input.kind,
    adapterId: identity.adapterId,
    key: identity.key,
    adapterVersion: ADAPTER_VERSION,
    ...(probe.version ? { harnessVersion: probe.version } : {}),
    capabilities: CAPABILITIES,
  })
  return result
}

async function pairingInput(args: string[]): Promise<HarnessPairingPayload> {
  const value = argValue(args, '--pair') ?? (await prompt('Pairing code: '))
  const parsed = parseHarnessPairingInput(value)
  if (!parsed) throw new Error('That is not a valid Clara harness pairing code')
  if (parsed.expiresAt <= Date.now()) throw new Error('That pairing code has expired')
  return parsed
}

function discoveryInput(args: string[]): DiscoveryInput {
  return {
    ...(argValue(args, '--opencode-url') ? { url: argValue(args, '--opencode-url') } : {}),
    ...(argValue(args, '--opencode-username')
      ? { username: argValue(args, '--opencode-username') }
      : {}),
    ...(argValue(args, '--opencode-password')
      ? { password: argValue(args, '--opencode-password') }
      : {}),
  }
}

async function promptOpenCode(args: string[]): Promise<{
  url: string
  username: string
  password?: string
}> {
  console.log('Could not discover a reachable OpenCode server.')
  const url = (await prompt('OpenCode URL [http://127.0.0.1:4096]: ')) || 'http://127.0.0.1:4096'
  const username = (await prompt('OpenCode username [opencode]: ')) || 'opencode'
  const password = await prompt('OpenCode password (leave blank for none): ')
  const config = {
    url: url.replace(/\/+$/, ''),
    username,
    ...(password ? { password } : {}),
  }
  const probe = await new OpenCodeClient(config.url, config.password, config.username).probe(3_000)
  if (!probe.ok) {
    throw new Error(`OpenCode is still unreachable (${probe.code}): ${probe.message ?? ''}`)
  }
  void args
  return config
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function printHelp(): void {
  console.log(`Clara OpenCode adapter

Usage:
  clara-adapter-opencode install [--pair <code>] [--opencode-url <url>]
  clara-adapter-opencode pair [--pair <code>] [--opencode-url <url>]
  clara-adapter-opencode serve
  clara-adapter-opencode status
  clara-adapter-opencode config-path

The adapter connects out to the hub over the same WebSocket and E2EE session
as the browser. It never listens on an inbound port.`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
