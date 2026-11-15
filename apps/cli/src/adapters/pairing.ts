import { main as hubMain } from '@clara/hub-server/main'
import { connect } from 'node:net'
import type { PanelHarnessPairing } from '@clara/shared-types'

export type PairingTransport = 'local' | 'relay' | 'docker'

export type PairingMain = (args: string[]) => Promise<void>

export type PairingOptions = {
  main?: PairingMain
  label?: string
  /** The direct hub address for a local or Docker install. */
  wsUrl?: string
}

/**
 * Ask the hub for a one-time adapter pairing code without starting a second
 * service. The hub command prints its JSON result, so stdout is captured for
 * the duration of the call and restored afterwards.
 */
export async function issueAdapterPairing(
  kind: string,
  transport: PairingTransport,
  options: PairingOptions = {}
): Promise<PanelHarnessPairing> {
  const stdout: string[] = []
  const stderr: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const originalExitCode = process.exitCode

  console.log = (...parts: unknown[]) => stdout.push(parts.map(String).join(' '))
  console.error = (...parts: unknown[]) => stderr.push(parts.map(String).join(' '))
  let exitCode: number | undefined
  try {
    await (options.main ?? hubMain)([
      'pair-adapter',
      '--kind',
      kind,
      '--transport',
      transport,
      ...(options.label ? ['--label', options.label] : []),
      ...(options.wsUrl ? ['--ws-url', options.wsUrl] : []),
      '--json',
    ])
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : undefined
  } catch (cause) {
    exitCode = 1
    stderr.push(cause instanceof Error ? cause.message : String(cause))
  } finally {
    console.log = originalLog
    console.error = originalError
    process.exitCode = originalExitCode
  }

  if (exitCode && exitCode !== 0) {
    throw new Error(
      stderr.join('\n').trim() ||
        `The hub could not issue a ${kind} pairing code (exit ${exitCode}).`
    )
  }
  const pairing = parsePairing(stdout)
  if (transport !== 'relay') await assertHubReachable(pairing.wsUrl)
  return pairing
}

/**
 * A local pairing code is useless when nothing listens on the hub port. The
 * code is issued in-process, so without this check the install downloads the
 * adapter first and only then reports a raw WebSocket error.
 */
async function assertHubReachable(wsUrl: string): Promise<void> {
  const endpoint = localEndpoint(wsUrl)
  if (!endpoint) return
  if (await canConnect(endpoint.host, endpoint.port)) return
  throw new Error(
    [
      `The hub is not answering at ${wsUrl}.`,
      'Start it with `clara start hub`, then try again.',
      'If the hub runs in Docker or on another machine, use `--transport docker` or `--transport relay`.',
    ].join('\n')
  )
}

function localEndpoint(wsUrl: string): { host: string; port: number } | undefined {
  let url: URL
  try {
    url = new URL(wsUrl)
  } catch {
    return undefined
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return undefined
  const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80))
  return Number.isInteger(port) && port > 0 ? { host, port } : undefined
}

function canConnect(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (connected: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function parsePairing(lines: readonly string[]): PanelHarnessPairing {
  for (const line of lines) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      const parsed = JSON.parse(text) as { pairing?: PanelHarnessPairing }
      if (parsed.pairing?.code && parsed.pairing.kind) return parsed.pairing
    } catch {
      // Keep looking; a log line can start with a brace.
    }
  }
  throw new Error('The hub did not return a pairing code.')
}
