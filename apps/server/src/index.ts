import { PROTOCOL_VERSION } from '@clara/shared-types'
import type { WebSocket } from 'ws'
import { Agent } from './agent.ts'
import { loadConfig } from './config.ts'
import { broadcast, startLocalServer } from './local-server.ts'
import { OpenCodeClient } from './opencode.ts'
import { printPairing } from './pairing.ts'
import { RelayClient, type RelayStatus } from './relay-client.ts'
import { SERVER_VERSION } from './version.ts'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'serve'
  const rotate = args.includes('--rotate')

  if (command !== 'serve' && command !== 'pair') {
    console.error(`Unknown command: ${command}`)
    console.error('Usage: clara-server [serve|pair] [--rotate]')
    process.exitCode = 2
    return
  }

  const config = loadConfig({ rotate })

  if (command === 'pair') {
    await printPairing(config, !args.includes('--no-qr'))
    return
  }

  const openCode = new OpenCodeClient(config.opencode.url, config.opencode.password)
  const opencodeVersion = await openCode.probeVersion()
  const info = {
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    opencodeVersion,
    room: config.relay?.room,
  }

  const localSockets = new Set<WebSocket>()
  const localAgent = new Agent({
    openCode,
    psk: config.psk,
    info,
    send: (frame) => broadcast(localSockets, frame),
    log,
  })

  const localServer = await startLocalServer({
    host: config.local.host,
    port: config.local.port,
    agent: localAgent,
    sockets: localSockets,
    log,
  })

  log(`local WebSocket listening on ws://${config.local.host}:${config.local.port}/ws`)
  if (opencodeVersion) log(`OpenCode ${opencodeVersion} at ${config.opencode.url}`)
  else log(`OpenCode is not answering at ${config.opencode.url}`)

  let relayClient: RelayClient | undefined
  if (config.relay) {
    const relayAgent = new Agent({
      openCode,
      psk: config.psk,
      info,
      send: (frame) => relayClient?.send(frame),
      log,
    })
    relayClient = new RelayClient({
      url: config.relay.url,
      room: config.relay.room,
      agentToken: config.relay.agentToken,
      agent: relayAgent,
      log,
      onStatus: (status) => logRelayStatus(status, config.relay?.url),
    })
    relayClient.start()
  }

  log(`pairing config: ${config.configPath}`)
  log('print a pairing code with: clara-server pair')
  if (args.includes('--pair') || args.includes('--qr')) {
    await printPairing(config, true)
  }

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    log('shutting down')
    relayClient?.close()
    await localServer.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('unhandledRejection', (cause) => log('unhandled rejection', cause))
}

function logRelayStatus(status: RelayStatus, url?: string): void {
  if (status === 'offline' || status === 'online' || status === 'connecting') {
    log(`relay ${status}${url ? ` (${url})` : ''}`)
  }
}

function log(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    const text = detail instanceof Error ? detail.message : String(detail)
    console.error(`[clara] ${message}: ${text}`)
    return
  }
  console.log(`[clara] ${message}`)
}

void main().catch((cause) => {
  log('fatal', cause)
  process.exit(1)
})
